import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { QuestionAnswer, QuestionRequest } from "@/lib/opencode";

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
      await client.question.reply({ requestID, answers, sessionID, formID: requestID } as never, {
        throwOnError: true,
      });
      return sessionID;
    },
    onSuccess: (sessionID, { requestID }) => {
      queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
        prev?.filter((question) => question.id !== requestID),
      );
    },
    onError: (error) => {
      toast.error("Couldn't send that answer", {
        description:
          error instanceof Error && error.message
            ? error.message
            : "The engine rejected the answer. Try again.",
      });
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
      await client.question.reject({ requestID, sessionID, formID: requestID } as never, {
        throwOnError: true,
      });
      return sessionID;
    },
    onSuccess: (sessionID, requestID) => {
      queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
        prev?.filter((question) => question.id !== requestID),
      );
    },
    onError: (error) => {
      toast.error("Couldn't dismiss that question", {
        description:
          error instanceof Error && error.message
            ? error.message
            : "The engine rejected the rejection. Try again.",
      });
    },
  });
}
