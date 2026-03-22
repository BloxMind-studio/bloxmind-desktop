import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { qk } from "@/lib/queryKeys";

export function useSessionStatuses() {
  return useQuery<Record<string, SessionStatus>>({ queryKey: qk.statuses, enabled: false });
}

export function useIsBusy(sessionId: string | null): boolean {
  return (
    useQuery<Record<string, SessionStatus>, Error, boolean>({
      queryKey: qk.statuses,
      enabled: false,
      select: useCallback(
        (d: Record<string, SessionStatus>) => (sessionId ? d[sessionId]?.type === "busy" : false),
        [sessionId],
      ),
    }).data ?? false
  );
}
