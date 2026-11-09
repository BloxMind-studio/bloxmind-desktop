import { useQuery } from "@tanstack/react-query";
import { STUDIO_MCP_SERVER_NAME } from "@/lib/bloxmindProgramManifest";
import { desktop } from "@/lib/desktop";
import type { OpencodeClient } from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { StudioMcpStatus } from "@/types/desktop";

const STUDIO_MCP_NAME = STUDIO_MCP_SERVER_NAME;

/** A Studio status check must not outlive this — a hung engine call would
 * otherwise leave the picker stuck on "checking" forever. */
export const STUDIO_CHECK_TIMEOUT_MS = 10_000;

/** In-flight checks shared between polls, so a hang is waited out once instead
 * of piling up new client calls every few seconds. */
const inflight = new WeakMap<object, Promise<Exclude<StudioConnectionState, "checking">>>();

export type StudioConnectionState = "checking" | "connected" | "waiting";

/** Why Studio's MCP helper can't be reached, when BloxMind knows. */
export type StudioMcpProblem = Extract<StudioMcpStatus["state"], "not_installed" | "unavailable">;

export function studioMcpProblem(status: StudioMcpStatus | undefined): StudioMcpProblem | null {
  return status?.state === "not_installed" || status?.state === "unavailable" ? status.state : null;
}

export async function checkStudioConnection(
  client: Pick<OpencodeClient, "mcp">,
): Promise<Exclude<StudioConnectionState, "checking">> {
  const key = client as object;
  const running = inflight.get(key);
  if (running) return running;

  const check = (async () => {
    try {
      const current = await client.mcp.status({});
      if (current.data?.[STUDIO_MCP_NAME]?.status === "connected") return "connected";

      await client.mcp.connect({ name: STUDIO_MCP_NAME }).catch(() => undefined);
      const refreshed = await client.mcp.status({});
      return refreshed.data?.[STUDIO_MCP_NAME]?.status === "connected" ? "connected" : "waiting";
    } catch {
      return "waiting" as const;
    }
  })();

  const guarded = new Promise<Exclude<StudioConnectionState, "checking">>((resolve) => {
    const timer = setTimeout(() => resolve("waiting"), STUDIO_CHECK_TIMEOUT_MS);
    check.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  }).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, guarded);
  return guarded;
}

export function useStudioConnection() {
  const { client } = useOpenCodeClient();

  const query = useQuery<Exclude<StudioConnectionState, "checking">>({
    queryKey: qk.studioConnection,
    queryFn: async () => {
      if (!client) return "waiting";
      return checkStudioConnection(client);
    },
    enabled: !!client,
    refetchInterval: (queryState) => (queryState.state.data === "connected" ? 10_000 : 3_000),
    retry: false,
  });

  const waiting = query.data === "waiting";
  const studioMcp = useQuery({
    queryKey: qk.studioMcpStatus,
    queryFn: () => desktop.getStudioMcpStatus(),
    enabled: !!client && waiting,
    refetchInterval: 3_000,
    retry: false,
  });

  return {
    state: query.isPending ? ("checking" as const) : (query.data ?? "waiting"),
    checking: query.isFetching,
    checkAgain: query.refetch,
    problem: waiting ? studioMcpProblem(studioMcp.data) : null,
  };
}
