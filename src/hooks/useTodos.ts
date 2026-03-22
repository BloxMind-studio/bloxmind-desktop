import type { Todo } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

const EMPTY: Todo[] = [];

export function useTodos(): Todo[] {
  const { activeSessionId } = useActiveSession();
  const { data } = useQuery<Todo[]>({
    queryKey: activeSessionId ? qk.todos(activeSessionId) : ["__noop_todos__"],
    enabled: !!activeSessionId,
  });
  return data ?? EMPTY;
}
