import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Command } from "@/lib/opencode";

import { CLIENT_COMMANDS, mergeCommands } from "@/lib/promptSuggestions";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useCommands(): Command[] {
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<Command[]>({
    queryKey: qk.commands,
    queryFn: async () => {
      if (!client) return [];
      const response = await client.command.list({}, { throwOnError: true });
      if (!Array.isArray(response.data)) return [];
      // Servers may omit `hints` (e.g. skill/MCP-sourced commands); guarantee the array.
      return response.data.map((command: Command) => ({
        ...command,
        hints: Array.isArray(command.hints) ? command.hints : [],
      }));
    },
    enabled: ready && !!client,
  });

  return useMemo(() => (data ? mergeCommands(data) : [...CLIENT_COMMANDS]), [data]);
}
