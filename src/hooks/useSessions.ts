import type { Session } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { usePreferences } from "@/providers/PreferencesProvider";

export function useSessions() {
  return useQuery<Session[]>({ queryKey: qk.sessions });
}

/** Filtered session list (BloxBot-only or all) */
export function useFilteredSessions() {
  const { showAllSessions, ownSessionIds } = usePreferences();
  const { data: sessions = [] } = useSessions();

  if (showAllSessions) return sessions;
  return sessions.filter((s) => ownSessionIds.has(s.id));
}
