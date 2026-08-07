import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/**
 * Reverts a specific message in a session, undoing its effects (including
 * file/code changes in Roblox Studio) and restoring the previous state.
 *
 * After reverting, the messages cache is invalidated so the UI refreshes
 * with the updated message list.
 */
export function useRevertMessage() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation<void, Error, { messageId: string }>({
    mutationFn: async ({ messageId }) => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      await client.session.revert(
        {
          sessionID: activeSessionId,
          messageID: messageId,
        },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      // Invalidate messages so the UI refreshes with the reverted state
      if (activeSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
        void queryClient.invalidateQueries({ queryKey: qk.todos(activeSessionId) });
      }
    },
    onError: (error) => {
      toast.error("Couldn't undo changes", { description: error.message });
    },
  });
}

/**
 * Restores all previously reverted messages in a session, redoing
 * the effects that were undone by a revert.
 *
 * After unreverting, the messages cache is invalidated so the UI refreshes.
 */
export function useUnrevertSession() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!client || !activeSessionId) throw new Error("No client or session");

      await client.session.unrevert(
        {
          sessionID: activeSessionId,
        },
        { throwOnError: true },
      );
    },
    onSuccess: () => {
      if (activeSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(activeSessionId) });
        void queryClient.invalidateQueries({ queryKey: qk.todos(activeSessionId) });
      }
    },
    onError: (error) => {
      toast.error("Couldn't redo changes", { description: error.message });
    },
  });
}
