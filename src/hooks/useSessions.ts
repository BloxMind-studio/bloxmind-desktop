import { useQuery } from "@tanstack/react-query";
import type { Session } from "@/lib/opencode";

import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useSessions() {
  const { client, ready } = useOpenCodeClient();

  return useQuery<Session[]>({
    queryKey: qk.sessions,
    queryFn: async () => {
      if (!client) return [];
      // OC2 `archived: true` returns *only* archived sessions; omit the filter
      // so the sidebar can see both active and snoozed sessions.
      const res = await client.experimental.session.list({}, { throwOnError: true });
      if (!res.data) return [];
      return (res.data as Session[])
        .filter(isVisibleSession)
        .sort((a: Session, b: Session) => b.time.created - a.time.created);
    },
    enabled: ready && !!client,
  });
}
