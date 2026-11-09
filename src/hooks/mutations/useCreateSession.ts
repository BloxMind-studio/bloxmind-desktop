import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import { toast } from "sonner";
import { analyticsProperties, errorAnalyticsProperties } from "@/lib/analytics";
import type { Session } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useCreateSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { selectSession } = useActiveSession();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("No client");
      const res = await client.session.create({}, { throwOnError: true });
      if (!res.data) throw new Error("No data");
      return res.data;
    },
    onSuccess: (newSession: Session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return [newSession];
        if (prev.some((s) => s.id === newSession.id)) return prev;
        return [newSession, ...prev];
      });

      // Clear messages/todos/questions/permissions for new session
      queryClient.setQueryData(qk.messages(newSession.id), {
        messageIds: [],
        messagesById: {},
      });
      queryClient.setQueryData(qk.todos(newSession.id), []);
      queryClient.setQueryData(qk.questions(newSession.id), []);
      queryClient.setQueryData(qk.permissions(newSession.id), []);

      selectSession(newSession.id);
      posthog.capture("session_created", analyticsProperties("sessions", { outcome: "success" }));
    },
    onError: (error) => {
      posthog.capture(
        "session_creation_failed",
        errorAnalyticsProperties("sessions", "creation", error),
      );
      // Creation used to fail silently; say so instead of doing nothing.
      toast.error("Couldn't create a session", {
        description:
          error instanceof Error && error.message
            ? error.message
            : "Check that the AI engine is running, then try again.",
      });
    },
  });
}
