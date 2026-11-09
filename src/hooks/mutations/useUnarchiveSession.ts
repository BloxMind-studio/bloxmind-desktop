import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { analyticsProperties, errorAnalyticsProperties } from "@/lib/analytics";
import type { Session } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useUnarchiveSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      // OC2 returns void; rely on queued state below rather than response shape.
      await client.session.update({ sessionID, archived: false }, { throwOnError: true });
      return { id: sessionID };
    },
    onSuccess: (session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (previous) => {
        if (!previous) return previous;
        return previous.map((item) => {
          if (item.id !== session.id) return item;
          const { archived: _archived, ...restTime } = item.time;
          return { ...item, time: restTime as typeof item.time };
        });
      });
      posthog.capture("session_unsnoozed", analyticsProperties("sessions", { outcome: "success" }));
    },
    onError: (error) =>
      posthog.capture(
        "session_unsnooze_failed",
        errorAnalyticsProperties("sessions", "unsnooze", error),
      ),
  });
}
