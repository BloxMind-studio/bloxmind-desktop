import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useSessionStatuses() {
  const { client, ready } = useOpenCodeClient();

  return useQuery<Record<string, SessionStatus>>({
    queryKey: qk.statuses,
    queryFn: async () => {
      if (!client) return {};
      const res = await client.session.status({}, { throwOnError: true });
      return res.data ?? {};
    },
    enabled: ready && !!client,
    // Watchdog: SSE normally keeps status real-time, but if an event is
    // missed/dropped (e.g. during a heavy operation or a stall) the session
    // would otherwise stay "busy" forever and the UI freeze on "Thinking…".
    // Polling reconciles the status with the server so it recovers.
    refetchInterval: 5_000,
    staleTime: 2_500,
  });
}

/**
 * Busy state with an idle-confirm latch.
 *
 * OpenCode can emit a transient `session.idle` between steps of a single
 * agent loop (e.g. after each tool call batch) and background refetches can
 * momentarily expose an "unknown" (undefined) status. Mirroring that raw
 * signal would flip the input's Stop button back to Send mid-turn and let the
 * user fire a second prompt while tools are still running. Once the session
 * has actually been busy, the busy state is therefore held until we can
 * confirm the turn really settled:
 *  - a flip to idle is held for a short confirm window — if another busy
 *    event arrives within it (the normal step-to-step rhythm), the session
 *    stays continuously busy; if idle persists past the window, we unlock.
 *  - an unknown/loading status holds the latch only for a bounded grace
 *    window, and the window is GATED ON MESSAGE ACTIVITY. A momentary blip
 *    (background refetch swapping cache entries) is shorter than the grace
 *    and keeps the Stop button latched, and as long as the message stream is
 *    still producing output (streaming deltas, tool parts arriving) the
 *    window keeps restarting — message activity is the authoritative "still
 *    working" signal because the engine fork can drop status events while a
 *    turn is running. But a PERSISTENT unknown with a quiet message stream
 *    must never lock the button forever: engines can drop the idle SSE event
 *    (anomalyco/opencode >= 1.14.42 drops SyncEvent publishes) and omit a
 *    settled session from the `/session/status` map entirely, in which case
 *    "unknown" IS the settled state. Before the grace window existed, such
 *    sessions latched the Stop button permanently even though the agent had
 *    finished its task.
 *
 * The latch is transition-based: sessions that start out idle (or have no
 * status yet) report false immediately, preserving the existing contract.
 */
const IDLE_CONFIRM_MS = 2_000;
const UNKNOWN_GRACE_MS = 30_000;

/**
 * Session ids currently reported busy (raw or latched) by any mounted
 * `useIsBusy` instance. Survives status-cache omissions caused by the
 * engine's dropped events, so close-time recovery in OpenCodeClientProvider
 * can still mark genuinely-running turns as interrupted when the app exits.
 */
export const latchedBusySessions = new Set<string>();

/**
 * Subscribes to the session's messages cache and returns its current value so
 * the busy latch can observe real agent output. The engine fork can drop
 * status events while the agent is still working, so the message stream is
 * the authoritative "still working" signal: streaming deltas and arriving
 * tool parts update this cache, and its object identity changes on every
 * dispatched message event.
 */
function useMessagesActivity(sessionId: string | null): MessagesCache | undefined {
  const queryClient = useQueryClient();
  return useSyncExternalStore(
    (onChange) => {
      if (!sessionId) return () => {};
      const queryHash = hashKey(qk.messages(sessionId));
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && event.query.queryHash === queryHash) {
          onChange();
        }
      });
    },
    () =>
      sessionId
        ? queryClient.getQueryData<MessagesCache>(qk.messages(sessionId))
        : undefined,
    () => undefined,
  );
}

export function useIsBusy(sessionId: string | null): boolean {
  const status = useSessionStatus(sessionId);
  const rawBusy = status !== undefined && status.type !== "idle";
  const messagesCache = useMessagesActivity(sessionId);

  const [latchedBusy, setLatchedBusy] = useState(false);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which evidence the currently-running unlock window is based on. */
  const unlockKindRef = useRef<"idle" | "unknown" | null>(null);
  const prevMessagesRef = useRef<MessagesCache | undefined>(undefined);

  useEffect(() => {
    const messageActivity = messagesCache !== prevMessagesRef.current;
    if (messageActivity) prevMessagesRef.current = messagesCache;

    if (rawBusy) {
      // Any busy observation cancels the pending unlock and latches busy.
      if (unlockTimerRef.current !== null) {
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
      unlockKindRef.current = null;
      setLatchedBusy(true);
      return;
    }
    if (!latchedBusy) return;
    if (unlockTimerRef.current !== null) {
      if (messageActivity) {
        // The agent is still producing output (streaming deltas, tool parts
        // arriving). Message activity is the authoritative "still working"
        // signal — the engine fork can drop status events while a turn is
        // running — so restart the unlock window instead of letting it
        // elapse mid-turn. The window only completes once the stream has
        // gone quiet for a full grace period.
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
        unlockKindRef.current = null;
      } else if (status !== undefined && unlockKindRef.current === "unknown") {
        // Defined idle is stronger evidence than "unknown": if the pending
        // window was started by an unknown status and a real idle arrives,
        // switch to the shorter idle-confirm window.
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
        unlockKindRef.current = null;
      } else {
        // Same-kind re-observation — e.g. new object identities from
        // background refetches with no real change — keeps the window.
        return;
      }
    }
    const grace = status === undefined ? UNKNOWN_GRACE_MS : IDLE_CONFIRM_MS;
    unlockKindRef.current = status === undefined ? "unknown" : "idle";
    unlockTimerRef.current = setTimeout(() => {
      unlockTimerRef.current = null;
      unlockKindRef.current = null;
      setLatchedBusy(false);
    }, grace);
  }, [rawBusy, status, latchedBusy, messagesCache]);

  // Reset the latch whenever the tracked session changes (not on mount) so a
  // busy session never bleeds its latch into the next one.
  const previousSessionIdRef = useRef(sessionId);
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    previousSessionIdRef.current = sessionId;
    if (unlockTimerRef.current !== null) {
      clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
    unlockKindRef.current = null;
    setLatchedBusy(false);
  }, [sessionId]);
  useEffect(() => {
    return () => {
      if (unlockTimerRef.current !== null) {
        clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
    };
  }, []);

  // Track latched/busy sessions for close-time recovery. The cleanup-on-dep-
  // change pattern guarantees removal as soon as the session unlocks, is
  // switched away from, or the component unmounts.
  useEffect(() => {
    if (!sessionId || !(rawBusy || latchedBusy)) return;
    latchedBusySessions.add(sessionId);
    return () => {
      latchedBusySessions.delete(sessionId);
    };
  }, [sessionId, rawBusy, latchedBusy]);

  return rawBusy || latchedBusy;
}

/**
 * Resolves the status for a single session from the shared `useSessionStatuses`
 * cache. Deriving from the bulk query (rather than mounting a second query
 * with the same key) avoids duplicate network requests and the `select`
 * callback churn that triggered unnecessary re-subscriptions.
 */
export function useSessionStatus(sessionId: string | null): SessionStatus | undefined {
  const { data: statuses } = useSessionStatuses();
  if (!sessionId) return undefined;
  return statuses?.[sessionId];
}
