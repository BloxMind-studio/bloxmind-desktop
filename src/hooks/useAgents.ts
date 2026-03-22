import type { Agent } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

const EMPTY: Agent[] = [];

export function useAgents(): Agent[] {
  const { data } = useQuery<Agent[]>({ queryKey: qk.agents });
  return data ?? EMPTY;
}
