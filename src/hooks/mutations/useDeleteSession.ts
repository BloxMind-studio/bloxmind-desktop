import type { Session } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export function useDeleteSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { activeSessionId, clearSession } = useActiveSession();
  const { removeSessionModel } = usePreferences();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      await client.session.delete({ sessionID });
      return sessionID;
    },
    onSuccess: (sessionID: string) => {
      removeSessionModel(sessionID);

      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== sessionID);
      });

      if (activeSessionId === sessionID) {
        clearSession();
      }
    },
  });
}
