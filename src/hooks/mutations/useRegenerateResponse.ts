import type { Part, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

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

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * React Query mutation hook that regenerates an assistant response.
 *
 * The OpenCode API has no native "regenerate" call, so the flow rebuilds the
 * truncated context explicitly:
 * 1. Find the user prompt that directly precedes the targeted response.
 * 2. Delete the assistant response (and any messages after it), then the
 *    anchor prompt itself. `session.deleteMessage` only removes messages —
 *    file changes are NOT reverted.
 * 3. Re-admit the identical prompt via `session.promptAsync` with the
 *    current model/agent/variant preferences, so the agent generates a
 *    fresh response from the retained history.
 *
 * Cache consistency comes for free: deletions emit `message.removed` SSE
 * events and the new run streams through the normal message pipeline, so no
 * manual cache surgery is needed.
 */
export function useRegenerateResponse() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = usePreferences();
  const queryClient = useQueryClient();

  return useMutation<void, Error, RegenerateInput, RegenerateContext | undefined>({
    mutationFn: async ({ assistantMessageId }: RegenerateInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
      const ids = cache?.messageIds ?? [];
      const assistantIndex = ids.indexOf(assistantMessageId);
      if (assistantIndex < 0) throw new Error("Message not found in this session");

      // Walk back to the user prompt that triggered this response.
      let anchorIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        if (cache?.messagesById[ids[i]]?.info.role === "user") {
          anchorIndex = i;
          break;
        }
      }
      if (anchorIndex < 0) throw new Error("No user prompt found before this response");
      const anchorId = ids[anchorIndex];

      // Replay the exact same prompt (text + image attachments).
      const promptParts = extractPromptParts(cache?.messagesById[anchorId]?.parts ?? []);
      if (promptParts.every((p) => p.type !== "text")) {
        promptParts.unshift({ type: "text", text: " " });
      }

      // Remove the old response and everything after it, then the anchor
      // prompt, newest-first so no dangling tail survives a mid-way failure.
      const toDelete: string[] = [anchorId, ...ids.slice(assistantIndex)].reverse();
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
  });
}
