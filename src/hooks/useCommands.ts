import type { Command } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { isBloxmindSkill } from "@/lib/agentSkillNames";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const EMPTY: Command[] = [];

/**
 * Hard-purge non-BloxMind skills from the "/" picker.
 *
 * OpenCode bundles embedded default skills (customize-opencode,
 * web-design-guidelines, site-specification, …) that `command.list()` returns
 * as skill-sourced commands, and the engine config cannot unregister them
 * (`skills.paths` only adds directories). Only app-shipped BloxMind/Roblox
 * skills may surface as slash commands — everything else skill-sourced is
 * dropped here. Native commands (source: "command"/"mcp") always pass.
 */
export function purgeForeignSkills(commands: Command[]): Command[] {
  return commands.filter((command) => command.source !== "skill" || isBloxmindSkill(command.name));
}

export function useCommands(): Command[] {
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<Command[]>({
    queryKey: qk.commands,
    queryFn: async () => {
      if (!client) return [];
      const response = await client.command.list({}, { throwOnError: true });
      return purgeForeignSkills(Array.isArray(response.data) ? response.data : []);
    },
    enabled: ready && !!client,
  });

  return data ?? EMPTY;
}
