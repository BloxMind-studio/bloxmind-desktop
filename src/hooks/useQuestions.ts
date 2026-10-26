import type { QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const NOOP_KEY = ["__noop-question__"] as const;

/**
 * The oldest unanswered question for the active session, or null. The cache
 * holds the whole queue in arrival order (see useActivePermission).
 */
export function useActiveQuestion(): QuestionRequest | null {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { data } = useQuery<QuestionRequest[]>({
    queryKey: activeSessionId ? qk.questions(activeSessionId) : NOOP_KEY,
    queryFn: async () => {
      if (!client || !activeSessionId) return [];
      const queryKey = qk.questions(activeSessionId);
      const beforeRevision =
        queryClient.getQueryState<QuestionRequest[]>(queryKey)?.dataUpdateCount ?? 0;
      const response = await client.question.list({}, { throwOnError: true });
      const afterState = queryClient.getQueryState<QuestionRequest[]>(queryKey);
      if ((afterState?.dataUpdateCount ?? 0) !== beforeRevision) return afterState?.data ?? [];
      return response.data?.filter((question) => question.sessionID === activeSessionId) ?? [];
    },
    enabled: ready && !!client && !!activeSessionId,
  });
  return data?.[0] ?? null;
}
