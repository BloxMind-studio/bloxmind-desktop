import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import type { CompactionState } from "@/lib/sseDispatch";

/**
 * Read the live compaction state for a session.
 *
 * The state is written by SSE (`session.next.compaction.*`) and by the manual
 * Compact mutation, so there is nothing to fetch: this query is a cache
 * subscription that re-renders whenever `setQueryData` touches the key.
 */
export function useCompactionState(sessionID: string | null): CompactionState | null {
  const { data } = useQuery<CompactionState | null>({
    queryKey: qk.compaction(sessionID ?? ""),
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  return sessionID ? (data ?? null) : null;
}
