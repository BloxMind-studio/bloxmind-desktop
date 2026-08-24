import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useAbort() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      const sessionID = activeSessionId;
      // Prefer the Electron bridge if present (ensures MCP loops are killed in the main process),
      // otherwise fall back to the direct OpenCode abort.
      const electronStop = (window as unknown as { electron?: { stopAgentProcess?: () => Promise<void> } })
        ?.electron?.stopAgentProcess;
      if (electronStop) {
        try {
          await electronStop();
        } catch {
          // Fall through to direct abort below
        }
      }
      // Also try an AbortController-style direct abort via the SDK — this is the primary path
      // in the current app and must set isGenerating=false immediately (see onMutate).
      try {
        const response = await client.session.abort({ sessionID }, { throwOnError: true });
        if (response.data !== true) throw new Error("OpenCode did not acknowledge the abort");
      } catch (err) {
        // If the server already considers the session idle (e.g. crash-recovery abort),
        // treat it as success so the UI still unlocks.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("not found") && !msg.toLowerCase().includes("idle")) throw err;
      }
      return sessionID;
    },
    onMutate: () => {
      if (!activeSessionId) return undefined;
      const previousStatuses = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
      // Optimistic: immediately mark the session as idle so the input unlocks and
      // the Stop button disappears without waiting for the server round-trip.
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => ({
        ...previous,
        [activeSessionId]: { type: "idle" },
      }));
      // Persist an "interrupted" marker so a Continue button can be shown after a manual stop.
      try {
        localStorage.setItem(`BloxMind:interrupted:${activeSessionId}`, String(Date.now()));
      } catch {
        // ignore storage errors (e.g. private mode)
      }
      return { previousStatuses, sessionID: activeSessionId } as const;
    },
    onSuccess: (sessionID) => {
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => ({
        ...previous,
        [sessionID]: { type: "idle" },
      }));
    },
    onError: (_err, _vars, context) => {
      if (!context || !("previousStatuses" in context) || !context.previousStatuses) return;
      // Roll back optimistic idle only if the server still thinks we are busy;
      // otherwise keep idle so the UI doesn't re-lock after a failed abort.
      const current = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
      if (current?.[context.sessionID]?.type === "idle") return;
      queryClient.setQueryData(qk.statuses, context.previousStatuses);
    },
  });
}
