import type { Todo } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const NOOP_KEY = ["__noop_todos__"] as const;
const EMPTY: Todo[] = [];

export function useTodos(): Todo[] {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<Todo[]>({
    queryKey: activeSessionId ? qk.todos(activeSessionId) : NOOP_KEY,
    queryFn: async () => {
      if (!client || !activeSessionId) return [];
      const res = await client.session.todo({ sessionID: activeSessionId });
      return res.data ?? [];
    },
    enabled: ready && !!client && !!activeSessionId,
  });
  return data ?? EMPTY;
}
