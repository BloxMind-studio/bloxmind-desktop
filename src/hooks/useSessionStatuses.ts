import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

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

export function useSessionStatus(sessionId: string | null): SessionStatus | undefined {
  const { client, ready } = useOpenCodeClient();

  return useQuery<Record<string, SessionStatus>, Error, SessionStatus | undefined>({
    queryKey: qk.statuses,
    queryFn: async () => {
      if (!client) return {};
      const res = await client.session.status({}, { throwOnError: true });
      return res.data ?? {};
    },
    enabled: ready && !!client,
    // Watchdog poll (see useSessionStatuses for rationale — both queries share
    // the same cache key, so a single active interval keeps the cache fresh).
    refetchInterval: 5_000,
    staleTime: 2_500,
    select: useCallback(
      (statuses: Record<string, SessionStatus>) => (sessionId ? statuses[sessionId] : undefined),
      [sessionId],
    ),
  }).data;
}
