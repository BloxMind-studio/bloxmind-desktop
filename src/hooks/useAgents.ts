import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@/lib/opencode";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const EMPTY: AppAgent[] = [];

/**
 * The engine's agent list carries both `id` (e.g. "build") and a display `name`
 * (e.g. "Build"). The engine keys everything — including session agent selection —
 * by `id`, so BloxMind must carry and send `id`, never the display name.
 */
export type AppAgent = Agent & { id: string };

export function useAgents(): AppAgent[] {
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<AppAgent[]>({
    queryKey: qk.agents,
    queryFn: async () => {
      if (!client) return [];
      const res = await client.app.agents({}, { throwOnError: true });
      const list = Array.isArray(res.data) ? res.data : [];
      return list.map((agent: Agent & { id?: string }) => ({
        ...agent,
        id: typeof agent.id === "string" ? agent.id : agent.name,
      }));
    },
    enabled: ready && !!client,
  });
  return data ?? EMPTY;
}
