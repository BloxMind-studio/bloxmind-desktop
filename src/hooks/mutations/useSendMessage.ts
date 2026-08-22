import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";

import {
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

// ── Types ────────────────────────────────────────────────────────────────

/** Input payload for sending a chat message. */
interface SendMessageInput {
  /** The text content of the message. */
  text: string;
  /** Optional image attachments to include in the message parts. */
  images?: Array<{ mime: string; url: string; filename?: string }>;
  /** Optional Studio target reference to use as the system prompt. */
  studioTargetReference?: string | null;
  /** Optional explicit system prompt override. */
  systemPrompt?: string | null;
}

/** Context passed between mutation lifecycle hooks for optimistic updates. */
interface SendMessageContext {
  sessionID: string;
  /** The session status before the mutation, used for rollback on error. */
  previousStatus: SessionStatus | undefined;
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * React Query mutation hook for sending a chat message to the active session.
 *
 * Lifecycle:
 * 1. **`mutationFn`** — Assembles message parts (text + images), resolves the
 *    model/agent/variant from preferences, calls `session.promptAsync`, and
 *    fires a `message_sent` analytics event.
 * 2. **`onMutate`** — Optimistically sets the session status to `busy` before
 *    the request fires, saving the previous status for rollback.
 * 3. **`onError`** — Fires a `message_send_failed` analytics event and rolls
 *    back the session status to its previous value (or removes it if there
 *    was none).
 *
 * @param options - Optional callbacks (e.g. `onError` for UI-level error handling).
 */
export function useSendMessage(options?: { onError?: (error: Error) => void }) {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();
  const queryClient = useQueryClient();

  return useMutation<void, Error, SendMessageInput, SendMessageContext | undefined>({
    mutationFn: async ({ text, images, studioTargetReference, systemPrompt }: SendMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      // Assemble message parts: text first, then any image attachments.
      const parts: Array<{ type: string; [k: string]: unknown }> = [{ type: "text", text }];
      if (images) {
        for (const img of images) {
          parts.push({ type: "file", mime: img.mime, url: img.url, filename: img.filename });
        }
      }

      // Build the prompt options.
      const opts: Record<string, unknown> = {
        sessionID: activeSessionId,
        parts,
      };

      // System prompt: explicit systemPrompt takes priority over studioTargetReference.
      if (systemPrompt) opts.system = systemPrompt;
      else if (studioTargetReference) opts.system = studioTargetReference;

      // Resolve provider/model from the selected model key (e.g. "anthropic/claude-3.5-sonnet").
      let provider: string | undefined;
      let model: string | undefined;

      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) {
          provider = providerID;
          model = modelID;
          opts.model = { providerID, modelID };
        }
      }

      if (selectedAgent) opts.agent = selectedAgent;
      if (selectedVariant) opts.variant = selectedVariant;

      // Send the prompt asynchronously (throws on error via throwOnError).
      await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0], {
        throwOnError: true,
      });

      // Analytics: track successful message send.
      posthog.capture(
        "message_sent",
        analyticsProperties(
          "chat",
          detailedAnalyticsProperties({
            outcome: "success",
            has_images: Boolean(images?.length),
            has_studio_target: Boolean(studioTargetReference),
            has_system_prompt: Boolean(systemPrompt),
            provider,
            model,
          }),
        ),
      );
    },

    // Optimistic update: set session to "busy" before the request fires.
    onMutate: () => {
      if (!activeSessionId) return undefined;
      const statuses = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
      const context: SendMessageContext = {
        sessionID: activeSessionId,
        previousStatus: statuses?.[activeSessionId],
      };
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => ({
        ...previous,
        [activeSessionId]: { type: "busy" },
      }));
      return context;
    },

    // Rollback on error: restore the previous session status.
    onError: (error, input, context) => {
      options?.onError?.(error);

      // Analytics: track failed message send.
      posthog.capture(
        "message_send_failed",
        errorAnalyticsProperties("chat", "send_message", error, {
          has_images: Boolean(input.images?.length),
          has_studio_target: Boolean(input.studioTargetReference),
          has_system_prompt: Boolean(input.systemPrompt),
        }),
      );

      // No context means onMutate didn't run — nothing to roll back.
      if (!context) return;

      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => {
        // Only roll back if the status is still "busy" (don't clobber newer updates).
        if (previous?.[context.sessionID]?.type !== "busy") return previous;
        const next = { ...previous };
        if (context.previousStatus) {
          // Restore the previous status.
          next[context.sessionID] = context.previousStatus;
        } else {
          // No previous status — remove the entry entirely.
          delete next[context.sessionID];
        }
        return next;
      });
    },

    onSuccess: (_data, _variables, context) => {
      // Ensure the user bubble appears even if the SSE `message.updated`
      // event is dropped or delayed: force a messages refetch for this session.
      if (context?.sessionID) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(context.sessionID) });
      }
    },

    // Reconcile the optimistic status with the server's authoritative value.
    // SSE normally drives the session back to idle, but a missed/dropped event
    // after `promptAsync` resolves would otherwise leave the optimistic "busy"
    // stuck forever (the 5s watchdog poll recovers it, but slowly). Fetching
    // status here converges the cache immediately on both success and error.
    onSettled: async (_data, _error, _input, context) => {
      if (!context || !client) return;
      // Fallback messages fetch — covers the case where SSE never delivered
      // `message.updated` (e.g. transient disconnect right after send).
      void queryClient.invalidateQueries({ queryKey: qk.messages(context.sessionID) });
      try {
        const res = await client.session.status({}, { throwOnError: true });
        const authoritative = res.data?.[context.sessionID];
        if (!authoritative) return;
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => {
          // Only reconcile when the cache still holds our optimistic "busy":
          // if a newer SSE event already landed (non-busy), that is fresher
          // than this fetch and must win.
          if (previous?.[context.sessionID]?.type !== "busy") return previous;
          return { ...previous, [context.sessionID]: authoritative };
        });
      } catch {
        // Transient fetch failure: keep the rolled-back/optimistic value; the
        // statuses watchdog poll reconciles on its next tick.
      }
    },
  });
}
