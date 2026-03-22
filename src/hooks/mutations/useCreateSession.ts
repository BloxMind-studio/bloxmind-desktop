import type { Session } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { capture } from "@/lib/telemetry";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export function useCreateSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { selectSession } = useActiveSession();
  const { selectedModel, addOwnSessionId, setSessionModel } = usePreferences();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("No client");
      const res = await client.session.create({});
      if (!res.data) throw new Error("No data");
      return res.data;
    },
    onSuccess: (newSession: Session) => {
      addOwnSessionId(newSession.id);

      if (selectedModel) {
        setSessionModel(newSession.id, selectedModel);
      }

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
      queryClient.setQueryData(qk.questions, null);
      queryClient.setQueryData(qk.permissions, null);

      selectSession(newSession.id);
      capture("session_created");
    },
  });
}
