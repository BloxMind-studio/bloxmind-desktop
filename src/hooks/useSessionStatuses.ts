import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
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

export function useIsBusy(sessionId: string | null): boolean {
  const status = useSessionStatus(sessionId);
  return status !== undefined && status.type !== "idle";
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
