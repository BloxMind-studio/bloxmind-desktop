import type { Session } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useSessions() {
  const { client, ready } = useOpenCodeClient();

  return useQuery<Session[]>({
    queryKey: qk.sessions,
    queryFn: async () => {
      if (!client) return [];
      const res = await client.experimental.session.list(
        { archived: true },
        { throwOnError: true },
      );
      if (!res.data) return [];
      return res.data.filter(isVisibleSession).sort((a, b) => b.time.created - a.time.created);
    },
    enabled: ready && !!client,
    // Watchdog poll (see useSessionStatuses for rationale): the session list is
    // normally kept fresh by SSE invalidation, but a dropped or reconnecting
    // stream could otherwise leave it stale silently. A slow poll reconciles it.
    refetchInterval: 30_000,
  });
}
