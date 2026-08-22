import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";

import { errorAnalyticsProperties } from "@/lib/analytics";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";
import { useProjectIndexContext } from "@/providers/ProjectIndexProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

// ── Types ──────────────────────────────────────────────────────────────────

interface RetryMessageInput {
  /** The failed assistant message to retry from. */
  assistantMessageId: string;
}

interface RetryMessageContext {
  sessionID: string;
  previousStatus: { type: string } | undefined;
}

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * React Query mutation that retries from a failed assistant message by
 * deleting the failed turn and re-sending the original user prompt.
 *
 * This is the "message-level retry" feature: the user clicks retry on a
 * specific failed message, and the hook replays the conversation up to that
 * point so the agent can try again.
 */
export function useRetryMessage() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();
  const queryClient = useQueryClient();
  const studioTargetReference = useStudioTargetOptional()?.promptReference ?? null;
  const { contextPrompt: projectIndexContext } = useProjectIndexContext();

  return useMutation<void, Error, RetryMessageInput, RetryMessageContext | undefined>({
    mutationFn: async ({ assistantMessageId }: RetryMessageInput) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      const cache = queryClient.getQueryData<{
        messageIds: string[];
        messagesById: Record<
          string,
          {
            info: { role: string };
            parts: Array<{
              type: string;
              text?: string;
              url?: string;
              mime?: string;
              filename?: string;
            }>;
          }
        >;
      }>(qk.messages(activeSessionId));
      const ids = cache?.messageIds ?? [];
      const assistantIndex = ids.indexOf(assistantMessageId);
      if (assistantIndex < 0) throw new Error("Message not found in this session");

      // Walk back to find the user prompt that triggered this response,
      // skipping legacy injected system-notification messages.
      let anchorIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i--) {
        const candidateId = ids[i];
        const candidate = cache?.messagesById[candidateId];
        if (candidate?.info.role !== "user") continue;
        if (
          candidate.parts.some(
            (p) => p.type === "text" && (p.text ?? "").startsWith("[SYSTEM_NOTIFICATION"),
          )
        )
          continue;
        anchorIndex = i;
        break;
      }
      if (anchorIndex < 0) throw new Error("No user prompt found before this response");
      const anchorId = ids[anchorIndex];

      // Replay the exact same prompt (text + image attachments).
      const promptParts: Array<{ type: string; [k: string]: unknown }> = [];
      const anchor = cache?.messagesById[anchorId];
      if (anchor) {
        for (const p of anchor.parts) {
          if (p.type === "text") {
            promptParts.push({ type: "text", text: p.text });
          } else if (p.type === "file") {
            const file: { type: string; [k: string]: unknown } = { type: "file", url: p.url };
            if (p.mime) file.mime = p.mime;
            if (p.filename) file.filename = p.filename;
            promptParts.push(file);
          }
        }
      }
      if (promptParts.every((p) => p.type !== "text")) {
        promptParts.unshift({ type: "text", text: " " });
      }

      // Delete the anchor and everything after it (the failed turn + trailing
      // messages), newest-first so no dangling tail survives a partial failure.
      const toDelete = ids.slice(anchorIndex).reverse();
      for (const messageID of toDelete) {
        await client.session.deleteMessage(
          { sessionID: activeSessionId, messageID },
          { throwOnError: true },
        );
      }

      // Re-send the prompt with the same options a fresh send would use.
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

    onMutate: () => {
      if (!activeSessionId) return undefined;
      const statuses = queryClient.getQueryData<Record<string, { type: string }>>(qk.statuses);
      const context: RetryMessageContext = {
        sessionID: activeSessionId,
        previousStatus: statuses?.[activeSessionId],
      };
      queryClient.setQueryData<Record<string, { type: string }>>(qk.statuses, (previous) => ({
        ...previous,
        [activeSessionId]: { type: "busy" },
      }));
      return context;
    },

    onError: (error, _input, context) => {
      posthog.capture(
        "message_retry_failed",
        errorAnalyticsProperties("chat", "retry_message", error),
      );

      if (!context) return;
      queryClient.setQueryData<Record<string, { type: string }>>(qk.statuses, (previous) => {
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

    onSuccess: () => {
      if (activeSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
      }
    },

    onSettled: async (_data, _error, _input, context) => {
      if (!context || !client) return;
      try {
        const res = await client.session.status({}, { throwOnError: true });
        const authoritative = res.data?.[context.sessionID];
        if (!authoritative) return;
        queryClient.setQueryData<Record<string, { type: string }>>(qk.statuses, (previous) => {
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
