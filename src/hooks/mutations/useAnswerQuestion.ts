import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useAnswerQuestion() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestID,
      answers,
    }: {
      requestID: string;
      answers: QuestionAnswer[];
    }) => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      const sessionID = activeSessionId;
      await client.question.reply({ requestID, answers }, { throwOnError: true });
      return sessionID;
    },
    onSuccess: (sessionID, { requestID }) => {
      queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
        prev?.filter((question) => question.id !== requestID),
      );
    },
  });
}

export function useRejectQuestion() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestID: string) => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      const sessionID = activeSessionId;
      await client.question.reject({ requestID }, { throwOnError: true });
      return sessionID;
    },
    onSuccess: (sessionID, requestID) => {
      queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
        prev?.filter((question) => question.id !== requestID),
      );
    },
  });
}
