import type { PermissionRequest, QuestionRequest, Todo } from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

interface ActiveSessionContextValue {
  activeSessionId: string | null;
  selectSession: (sessionID: string) => Promise<void>;
  clearSession: () => void;
  /** Ref that always holds the current activeSessionId  - used by SSE dispatch */
  activeSessionIdRef: React.RefObject<string | null>;
}

export const ActiveSessionContext = createContext<ActiveSessionContextValue>({
  activeSessionId: null,
  selectSession: async () => {},
  clearSession: () => {},
  activeSessionIdRef: { current: null },
});

export function useActiveSession() {
  return useContext(ActiveSessionContext);
}

export function ActiveSessionProvider({
  children,
  activeSessionIdRef,
}: {
  children: ReactNode;
  activeSessionIdRef: React.MutableRefObject<string | null>;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  const selectSession = useCallback(
    async (sessionID: string) => {
      if (!client) return;
      try {
        const [_sessionRes, msgsRes] = await Promise.all([
          client.session.get({ sessionID }),
          client.session.messages({ sessionID }),
        ]);

        if (msgsRes.data) {
          const byId: Record<
            string,
            {
              info: (typeof msgsRes.data)[number]["info"];
              parts: (typeof msgsRes.data)[number]["parts"];
            }
          > = {};
          const ids: string[] = [];
          for (const m of msgsRes.data) {
            byId[m.info.id] = m;
            ids.push(m.info.id);
          }
          queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), {
            messageIds: ids,
            messagesById: byId,
          });
        }

        // Fetch todos, questions, and permissions in parallel
        const [todoRes, qRes, pRes] = await Promise.allSettled([
          client.session.todo({ sessionID }),
          client.question.list({}),
          client.permission.list({}),
        ]);

        queryClient.setQueryData<Todo[]>(
          qk.todos(sessionID),
          todoRes.status === "fulfilled" ? (todoRes.value.data ?? []) : [],
        );

        const activeQ =
          qRes.status === "fulfilled" && qRes.value.data
            ? (qRes.value.data.find((q: QuestionRequest) => q.sessionID === sessionID) ?? null)
            : null;
        queryClient.setQueryData<QuestionRequest | null>(qk.questions, activeQ);

        const activeP =
          pRes.status === "fulfilled" && pRes.value.data
            ? (pRes.value.data.find((p: PermissionRequest) => p.sessionID === sessionID) ?? null)
            : null;
        queryClient.setQueryData<PermissionRequest | null>(qk.permissions, activeP);

        activeSessionIdRef.current = sessionID;
        setActiveSessionId(sessionID);
      } catch (err) {
        console.error("Failed to select session:", err);
      }
    },
    [client, queryClient],
  );

  const clearSession = useCallback(() => {
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
  }, []);

  const value: ActiveSessionContextValue = {
    activeSessionId,
    selectSession,
    clearSession,
    activeSessionIdRef,
  };

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}
