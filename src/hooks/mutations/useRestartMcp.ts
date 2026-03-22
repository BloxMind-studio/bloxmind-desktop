import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useRestartMcp() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("No client");
      try {
        await client.mcp.disconnect({ name: "roblox-studio" });
      } catch {
        // May already be disconnected
      }
      try {
        await client.mcp.connect({ name: "roblox-studio" });
      } catch (err) {
        console.error("Failed to restart MCP server:", err);
        throw err;
      }
    },
    onMutate: () => {
      // Reset to unknown while restarting
      queryClient.setQueryData(qk.studioStatus, { status: "unknown", error: null });
    },
  });
}
