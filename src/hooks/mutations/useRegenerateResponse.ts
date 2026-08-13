import type { Part, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import { useProjectIndexContext } from "@/providers/ProjectIndexProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import type { MessageWithParts } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────

/** Input payload for regenerating an assistant response. */
interface RegenerateInput {
  /** The assistant message whose response should be regenerated. */
  assistantMessageId: string;
}

/** Context passed between mutation lifecycle hooks for rollback on error. */
interface RegenerateContext {
  sessionID: string;
  /** The session status before the mutation, used for rollback on error. */
  previousStatus: SessionStatus | undefined;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extracts the replayable prompt parts (text + image attachments) from the
 * user message that triggered the response being regenerated. Everything
 * else (tool results, system notifications) belongs to the agent's reply
 * and must not be replayed.
 */
function extractPromptParts(anchorParts: Part[]): Array<{ type: string; [k: string]: unknown }> {
  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  for (const part of anchorParts) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "file") {
      const file: { type: string; [k: string]: unknown } = { type: "file", url: part.url };
      if (part.mime) file.mime = part.mime;
      if (part.filename) file.filename = part.filename;
      parts.push(file);
    }
  }
  return parts;
}

/**
 * Legacy sessions contain visible user messages injected by the old restore
 * flow ("[SYSTEM_NOTIFICATION_RESTORE]…"). They must never be replayed as a
 * real prompt, so the anchor walk skips them and keeps looking backward.
 */
function isInjectedSystemNotification(msg: MessageWithParts | undefined): boolean {
  return (
    msg?.parts.some((p) => p.type === "text" && p.text.startsWith("[SYSTEM_NOTIFICATION")) ?? false
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * React Query mutation hook that regenerates an assistant response.
 *
 * The OpenCode API has no native "regenerate" call, so the flow rebuilds the
 * truncated context explicitly:
 * 1. Find the user prompt that directly precedes the targeted response
 *    (skipping legacy injected system-notification messages).
 * 2. Delete the anchor prompt and everything from it onward — the old
 *    response plus any trailing messages — via `session.deleteMessage`,
 *    which only removes messages and never reverts file changes.
 * 3. Re-admit the identical prompt via `session.promptAsync` with the
 *    current model/agent/variant preferences and the same system context
 *    a fresh send attaches, so the agent generates a fresh response from
 *    the retained history.
 *
 * Cache consistency comes for free: deletions emit `message.removed` SSE
 * events and the new run streams through the normal message pipeline, so no
 * manual cache surgery is needed.
 */
export function useRegenerateResponse() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();
  const queryClient = useQueryClient();
  // Same system context ChatInput attaches to every fresh send, so a
  // regenerated turn runs with the identical prompt environment.
  const studioTargetReference = useStudioTargetOptional()?.promptReference ?? null;
  const { contextPrompt: projectIndexContext } = useProjectIndexContext();

  return useMutation<void, Error, RegenerateInput, RegenerateContext | undefined>({
    mutationFn: async ({ assistantMessageId }: RegenerateInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
      const ids = cache?.messageIds ?? [];
      const assistantIndex = ids.indexOf(assistantMessageId);
      if (assistantIndex < 0) throw new Error("Message not found in this session");

      // Walk back to the user prompt that triggered this response, skipping
      // legacy injected system-notification messages.
      let anchorIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        const candidate = cache?.messagesById[ids[i]];
        if (candidate?.info.role !== "user") continue;
        if (isInjectedSystemNotification(candidate)) continue;
        anchorIndex = i;
        break;
      }
      if (anchorIndex < 0) throw new Error("No user prompt found before this response");
      const anchorId = ids[anchorIndex];

      // Replay the exact same prompt (text + image attachments).
      const promptParts = extractPromptParts(cache?.messagesById[anchorId]?.parts ?? []);
      if (promptParts.every((p) => p.type !== "text")) {
        promptParts.unshift({ type: "text", text: " " });
      }

      // Truncate the conversation at the anchor: delete the prompt and
      // everything after it (the old response plus any trailing messages),
      // newest-first so no dangling tail survives a mid-way failure. The
      // anchor itself is replayed verbatim in the next step.
      const toDelete: string[] = ids.slice(anchorIndex).reverse();
      for (const messageID of toDelete) {
        await client.session.deleteMessage(
          { sessionID: activeSessionId, messageID },
          { throwOnError: true },
        );
      }

      // Re-admit the prompt with the same options a fresh send would use.
      const opts: Record<string, unknown> = {
        sessionID: activeSessionId,
        parts: promptParts,
      };
      const system = [studioTargetReference, projectIndexContext].filter(Boolean).join("\n\n");
      if (system) opts.system = system;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) opts.model = { providerID, modelID };
      }
      if (selectedAgent) opts.agent = selectedAgent;
      if (selectedVariant) opts.variant = selectedVariant;

      await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0], {
        throwOnError: true,
      });
    },

    // Optimistic update: set session to "busy" so the streaming indicator
    // appears immediately, before the delete/re-admit round-trips resolve.
    onMutate: () => {
      if (!activeSessionId) return undefined;
      const statuses = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
      const context: RegenerateContext = {
        sessionID: activeSessionId,
        previousStatus: statuses?.[activeSessionId],
      };
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => ({
        ...previous,
        [activeSessionId]: { type: "busy" },
      }));
      return context;
    },

    // Rollback on error: restore the previous session status and surface the
    // reason. The conversation stays consistent even on partial failure —
    // deletions are permanent but the retained history is still a valid,
    // sendable context.
    onError: (error, _input, context) => {
      toast.error("Couldn't regenerate response", { description: error.message });

      if (!context) return;
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => {
        // Only roll back if the status is still "busy" (don't clobber newer updates).
        if (previous?.[context.sessionID]?.type !== "busy") return previous;
        const next = { ...previous };
        if (context.previousStatus) {
          next[context.sessionID] = context.previousStatus;
        } else {
          delete next[context.sessionID];
        }
        return next;
      });
    },

    // Belt and braces: SSE already removed the deleted messages, but force a
    // refetch so the re-admitted prompt and fresh response render promptly.
    onSuccess: () => {
      if (activeSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
      }
    },

    // Reconcile the optimistic status with the server's authoritative value.
    // A missed/dropped SSE status event would otherwise leave the "busy"
    // written by onMutate stuck even after the re-admitted prompt resolves;
    // fetching status on settle converges the cache immediately.
    onSettled: async (_data, _error, _input, context) => {
      if (!context || !client) return;
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
