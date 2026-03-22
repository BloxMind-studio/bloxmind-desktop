import type { Session } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

export function useSessions() {
  return useQuery<Session[]>({ queryKey: qk.sessions, enabled: false });
}
