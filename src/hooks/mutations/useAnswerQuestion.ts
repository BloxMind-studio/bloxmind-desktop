import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useAnswerQuestion() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestID,
      answers,
    }: {
      requestID: string;
      answers: QuestionAnswer[];
    }) => {
      if (!client) throw new Error("No client");
      await client.question.reply({ requestID, answers });
    },
    onSuccess: () => {
      queryClient.setQueryData<QuestionRequest | null>(qk.questions, null);
    },
  });
}

export function useRejectQuestion() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestID: string) => {
      if (!client) throw new Error("No client");
      await client.question.reject({ requestID });
    },
    onSuccess: () => {
      queryClient.setQueryData<QuestionRequest | null>(qk.questions, null);
    },
  });
}
