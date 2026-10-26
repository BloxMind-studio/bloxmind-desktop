import type { OpencodeClient, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/**
 * Fetch the status snapshot without clobbering a newer one.
 *
 * The 5 s watchdog poll shares `qk.statuses` with the SSE writer. If a
 * `session.status`/`session.idle` event lands while a poll is in flight, the
 * poll's response is older than the cache; returning it would flip a session
 * back to "busy" (or strand it there) until the next poll.
 */
export async function fetchStatuses(
  client: OpencodeClient | null,
  queryClient: QueryClient,
): Promise<Record<string, SessionStatus>> {
  if (!client) return {};
  const key = qk.statuses;
  const beforeRevision =
    queryClient.getQueryState<Record<string, SessionStatus>>(key)?.dataUpdateCount ?? 0;
  const response = await client.session.status({}, { throwOnError: true });
  const afterState = queryClient.getQueryState<Record<string, SessionStatus>>(key);
  if ((afterState?.dataUpdateCount ?? 0) !== beforeRevision) return afterState?.data ?? {};
  return response.data ?? {};
}

export function useSessionStatuses() {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<Record<string, SessionStatus>>({
    queryKey: qk.statuses,
    queryFn: () => fetchStatuses(client, queryClient),
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
 * True while the session is actively working on a turn. Any non-idle status
 * counts as working — not just "busy" — so transient states like "retry"
 * never get mistaken for idle (which would reveal message controls and
 * checkpoint actions in the middle of the agent's work).
 */
export function isSessionWorking(status: SessionStatus | undefined): boolean {
  return status !== undefined && status.type !== "idle";
}

export function useIsBusy(sessionId: string | null): boolean {
  return isSessionWorking(useSessionStatus(sessionId));
}

export function useSessionStatus(sessionId: string | null): SessionStatus | undefined {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<Record<string, SessionStatus>, Error, SessionStatus | undefined>({
    queryKey: qk.statuses,
    queryFn: () => fetchStatuses(client, queryClient),
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
