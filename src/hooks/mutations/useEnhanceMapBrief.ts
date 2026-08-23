import { useMutation } from "@tanstack/react-query";
import {
  MAP_FIELDS_ENHANCEMENT_SCHEMA,
  type MapMode,
  mapModeOption,
  resolveEnhancedMapFields,
} from "@/lib/mapRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

export interface EnhanceMapBriefInput {
  brief: string;
  mode: MapMode;
}

export function useEnhanceMapBrief() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();

  return useMutation({
    mutationFn: async ({ brief, mode }: EnhanceMapBriefInput) => {
      if (!client || !activeSessionId) {
        throw new Error("Open a chat before enhancing a map brief.");
      }
      if (!brief.trim()) throw new Error("Describe the map before enhancing it.");

      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      const created = await client.session.create(
        {
          title: "Map brief enhancement (temporary)",
          agent: selectedAgent ?? undefined,
          metadata: { BloxMindHidden: true, purpose: "enhance" },
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        },
        { throwOnError: true },
      );
      const enhancementSessionId = created.data?.id;
      if (!enhancementSessionId) throw new Error("Couldn't start the map brief enhancer.");

      try {
        const modeOption = mapModeOption(mode);
        const response = await client.session.prompt(
          {
            sessionID: enhancementSessionId,
            model,
            agent: selectedAgent ?? undefined,
            variant: selectedVariant ?? undefined,
            format: {
              type: "json_schema",
              schema: MAP_FIELDS_ENHANCEMENT_SCHEMA,
              retryCount: 2,
            },
            system:
              "You expand short ideas into a complete, detailed Roblox map build brief. If you support JSON schema, return the requested JSON object. Otherwise return plain labeled lines, one field per line, e.g.: player count: 4v4, traversal time: 3 minutes, theme pillars: neon dusk, notes: ... Never call tools and never modify files or Roblox Studio.",
            parts: [
              {
                type: "text",
                text: `Expand the map idea below into a full build brief for a Roblox map in "${modeOption.label}" mode (${modeOption.hint}). Fill EVERY field: rewrite the brief as an immersive 2-4 sentence summary (theme, atmosphere, signature gameplay moment); propose a player count; propose a traversal time; list theme pillars; list landmarks; list zones; and make notes covering flow, scale, and pacing. If returning JSON use exactly these keys: brief, playerCount, traversalTime, themePillars, landmarks, zones, notes. Otherwise return one line per field as "key: value". Be concrete and specific.\n\nIDEA\n${brief.trim()}`,
              },
            ],
          },
          { throwOnError: true },
        );
        return resolveEnhancedMapFields(response.data?.info, response.data?.parts);
      } finally {
        await client.session.delete({ sessionID: enhancementSessionId }).catch(() => undefined);
      }
    },
  });
}
