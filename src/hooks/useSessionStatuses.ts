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
      const res = await client!.session.status({});
      return res.data ?? {};
    },
    enabled: ready && !!client,
  });
}

export function useIsBusy(sessionId: string | null): boolean {
  const { client, ready } = useOpenCodeClient();

  return (
    useQuery<Record<string, SessionStatus>, Error, boolean>({
      queryKey: qk.statuses,
      queryFn: async () => {
        const res = await client!.session.status({});
        return res.data ?? {};
      },
      enabled: ready && !!client,
      select: useCallback(
        (d: Record<string, SessionStatus>) => (sessionId ? d[sessionId]?.type === "busy" : false),
        [sessionId],
      ),
    }).data ?? false
  );
}
