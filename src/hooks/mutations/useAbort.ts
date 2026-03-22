import { useMutation } from "@tanstack/react-query";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useAbort() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();

  return useMutation({
    mutationFn: async () => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      await client.session.abort({ sessionID: activeSessionId });
    },
  });
}
