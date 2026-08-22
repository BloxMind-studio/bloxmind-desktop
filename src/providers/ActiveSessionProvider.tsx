import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useSessions } from "@/hooks/useSessions";
import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";

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
  const queryClient = useQueryClient();
  const { data: sessions } = useSessions();

  const syncRojoToSession = useCallback((sessionID: string) => {
    void desktop
      .rojoStartForSession(sessionID)
      .then((status) => {
        if (status.active) {
          toast("Rojo switched to this session", {
            description: `Rojo is serving this session's project on port ${status.port}. In Roblox Studio's Rojo plugin, press Disconnect, then Connect to load the correct project.`,
            duration: 8000,
          });
        }
      })
      .catch((error: unknown) => {
        toast.error("Rojo switch failed", {
          description: error instanceof Error ? error.message : String(error),
          duration: 8000,
        });
      });
  }, []);

  const selectSession = useCallback(
    async (sessionID: string) => {
      const wasActive = activeSessionIdRef.current === sessionID;
      activeSessionIdRef.current = sessionID;
      setActiveSessionId(sessionID);
      queryClient.setQueryData(qk.sessionError(sessionID), null);

      // Remember this session so the next launch can resume it.
      void desktop.sessionStoreSetLastActive(sessionID).catch(() => undefined);

      // A session switch must never leak the previous session's files into the
      // newly opened Roblox Studio Place. Point Rojo at an isolated, freshly
      // generated workspace for this session and surface the
      // Disconnect → Connect prompt to the user.
      if (!wasActive) {
        syncRojoToSession(sessionID);
      }

      // Mark every session-owned snapshot stale. The newly mounted observers fetch
      // them once, while switching remains immediate and cannot race an older click.
      await Promise.all(
        [
          qk.messages(sessionID),
          qk.todos(sessionID),
          qk.questions(sessionID),
          qk.permissions(sessionID),
        ].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" }),
        ),
      );
    },
    [queryClient, activeSessionIdRef, syncRojoToSession],
  );

  const clearSession = useCallback(() => {
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
  }, [activeSessionIdRef]);

  // On startup, with no session chosen yet, resume the one the user last had
  // open. The engine loses sessions on restart, so this is what makes history
  // feel persistent rather than vanishing every launch.
  useEffect(() => {
    if (activeSessionId || !sessions || sessions.length === 0) return;
    let cancelled = false;
    void desktop.sessionStoreGetLastActive().then((last) => {
      if (cancelled || !last) return;
      if (sessions.some((session) => session.id === last)) void selectSession(last);
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, activeSessionId, selectSession]);

  const value = useMemo<ActiveSessionContextValue>(
    () => ({ activeSessionId, selectSession, clearSession, activeSessionIdRef }),
    [activeSessionId, selectSession, clearSession, activeSessionIdRef],
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}
