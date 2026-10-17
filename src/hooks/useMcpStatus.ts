import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/** The engine's view of one MCP server, normalized for the Integrations tab. */
export type McpServerLiveState =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "connecting"
  | "unknown";

export interface McpServerLiveStatus {
  state: McpServerLiveState;
  error: string | null;
}

const KNOWN_STATES: readonly McpServerLiveState[] = [
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "connecting",
];

function normalizeStatus(entry: unknown): McpServerLiveStatus {
  if (!entry || typeof entry !== "object") return { state: "unknown", error: null };
  const record = entry as { status?: unknown; error?: unknown };
  const state =
    typeof record.status === "string" && (KNOWN_STATES as readonly string[]).includes(record.status)
      ? (record.status as McpServerLiveState)
      : "unknown";
  const error = typeof record.error === "string" ? record.error : null;
  return { state, error };
}

/**
 * Live status for every MCP server the engine knows, polled while the
 * Integrations tab is visible. Servers missing from the map are reported as
 * `unknown` (e.g. a server that failed to start after being added at runtime,
 * which the engine only discovers on the next launch).
 */
export function useMcpStatus(enabled = true) {
  const { client } = useOpenCodeClient();

  const query = useQuery<Record<string, McpServerLiveStatus>>({
    queryKey: qk.mcpStatus,
    queryFn: async () => {
      if (!client) return {};
      const result = await client.mcp.status({});
      const data = (result.data ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(data).map(([name, entry]) => [name, normalizeStatus(entry)]),
      );
    },
    enabled: enabled && !!client,
    refetchInterval: 10_000,
    retry: false,
  });

  return {
    statuses: query.data ?? {},
    isLoading: query.isPending,
    refresh: query.refetch,
  };
}
