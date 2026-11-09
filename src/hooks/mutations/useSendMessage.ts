import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { useAllModels } from "@/hooks/useProviders";
import {
  aiTracer,
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
import { IMAGE_INPUT_UNAVAILABLE_NOTE, modelAcceptsImages } from "@/lib/imageSupport";
import { findModelInfo } from "@/lib/modelSpecs";
import type { SessionStatus } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { verificationGuidance } from "@/lib/verification";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

const ASSET_UPLOAD_SAFETY_NOTE =
  "When uploading or creating assets (models, images, or files): upload only the exact bytes the user previewed or explicitly approved; never upload the same asset twice; make uploads resume-safe/idempotent when possible.";

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
  const { selectedModel, selectedAgent, selectedVariant, verificationLevel } = usePreferences();
  const allModels = useAllModels();
  const queryClient = useQueryClient();

  // The provider tells us whether this model can read images. `undefined`
  // means "unknown", so only a confident `false` changes the request.
  const acceptsImages = modelAcceptsImages(findModelInfo(selectedModel ?? undefined, allModels));

  return useMutation<void, Error, SendMessageInput, SendMessageContext | undefined>({
    mutationFn: async ({ text, images, studioTargetReference, systemPrompt }: SendMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      // Never attach images to a model that cannot read them: one screenshot
      // otherwise makes every later request fail upstream.
      const sentImages = acceptsImages === false ? undefined : images;

      // Assemble message parts: text first, then any image attachments.
      const parts: Array<{ type: string; [k: string]: unknown }> = [{ type: "text", text }];
      if (sentImages) {
        for (const img of sentImages) {
          parts.push({ type: "file", mime: img.mime, url: img.url, filename: img.filename });
        }
      }

      // Build the prompt options.
      const opts: Record<string, unknown> = {
        sessionID: activeSessionId,
        parts,
      };

      // System prompt: explicit systemPrompt takes priority over
      // studioTargetReference. The verification guidance is appended to either,
      // so every send carries the level the user picked without a restart.
      const baseSystemPrompt = systemPrompt || studioTargetReference || "";
      const guidance = verificationGuidance(verificationLevel);
      const notes = [guidance];
      if (acceptsImages === false) notes.push(IMAGE_INPUT_UNAVAILABLE_NOTE);
      // When uploading or creating assets (models/images), only upload the exact
      // bytes the user previewed, never upload the same asset twice, and make
      // uploads resume-safe/idempotent when possible.
      notes.push(ASSET_UPLOAD_SAFETY_NOTE);
      opts.system = [baseSystemPrompt, ...notes].filter(Boolean).join("\n\n");

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

      aiTracer.beginTurn({
        sessionID: activeSessionId,
        text,
        imageCount: sentImages?.length ?? 0,
        provider,
        model,
        agent: selectedAgent ?? undefined,
        variant: selectedVariant ?? undefined,
      });
      try {
        const sent = await client.session.promptAsync(
          opts as Parameters<typeof client.session.promptAsync>[0],
          { throwOnError: true },
        );
        // OC2 returns the queued user message; bind it as the turn's trace id.
        const sentID = (sent as { data?: { id?: string } } | undefined)?.data?.id;
        if (typeof sentID === "string") aiTracer.bindUserMessage(activeSessionId, sentID);
      } catch (error) {
        aiTracer.cancelTurn(activeSessionId);
        throw error;
      }

      // Analytics: track successful message send.
      posthog.capture(
        "message_sent",
        analyticsProperties(
          "chat",
          detailedAnalyticsProperties({
            outcome: "success",
            has_images: Boolean(sentImages?.length),
            images_blocked: acceptsImages === false && Boolean(images?.length),
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
  });
}
