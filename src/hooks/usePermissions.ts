import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const NOOP_KEY = ["__noop-permission__"] as const;

/**
 * The oldest unanswered permission request for the active session, or null.
 *
 * The cache holds the whole queue in arrival order so a second request does not
 * replace the first; the UI answers the head and the next one takes its place.
 */
export function useActivePermission(): PermissionRequest | null {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { data } = useQuery<PermissionRequest[]>({
    queryKey: activeSessionId ? qk.permissions(activeSessionId) : NOOP_KEY,
    queryFn: async () => {
      if (!client || !activeSessionId) return [];
      const queryKey = qk.permissions(activeSessionId);
      const beforeRevision =
        queryClient.getQueryState<PermissionRequest[]>(queryKey)?.dataUpdateCount ?? 0;
      const response = await client.permission.list({}, { throwOnError: true });
      const afterState = queryClient.getQueryState<PermissionRequest[]>(queryKey);
      if ((afterState?.dataUpdateCount ?? 0) !== beforeRevision) return afterState?.data ?? [];
      return response.data?.filter((permission) => permission.sessionID === activeSessionId) ?? [];
    },
    enabled: ready && !!client && !!activeSessionId,
  });
  return data?.[0] ?? null;
}
