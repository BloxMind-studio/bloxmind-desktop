import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { analyticsProperties, errorAnalyticsProperties } from "@/lib/analytics";
import type { Session } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useArchiveSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { activeSessionId, clearSession } = useActiveSession();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      // OC2 returns void; rely on queued state below rather than response shape.
      await client.session.update({ sessionID, archived: true }, { throwOnError: true });
      return { id: sessionID };
    },
    onSuccess: (session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (previous) => {
        if (!previous) return previous;
        return previous.map((item) =>
          item.id === session.id ? { ...item, time: { ...item.time, archived: Date.now() } } : item,
        );
      });

      if (activeSessionId === session.id) {
        clearSession();
      }
      posthog.capture("session_snoozed", analyticsProperties("sessions", { outcome: "success" }));
    },
    onError: (error) =>
      posthog.capture(
        "session_snooze_failed",
        errorAnalyticsProperties("sessions", "snooze", error),
      ),
  });
}
