import { useMutation } from "@tanstack/react-query";
import {
  MAP_BRIEF_ENHANCEMENT_SCHEMA,
  type MapMode,
  mapModeOption,
  resolveEnhancedMapBrief,
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
              schema: MAP_BRIEF_ENHANCEMENT_SCHEMA,
              retryCount: 2,
            },
            system:
              "You rewrite short ideas into precise prompts for building Roblox maps. Return only the requested structured data. Never call tools and never modify files or Roblox Studio.",
            parts: [
              {
                type: "text",
                text: `Rewrite the map idea below into one detailed, immersive map brief (2-4 sentences) for a Roblox map in the "${modeOption.label}" mode (${modeOption.hint}). Describe the theme, atmosphere, named zones, key landmarks, player flow, scale, and the signature gameplay moment. Do not mention Roblox tools.\n\nIDEA\n${brief.trim()}`,
              },
            ],
          },
          { throwOnError: true },
        );
        return resolveEnhancedMapBrief(response.data?.info, response.data?.parts);
      } finally {
        await client.session.delete({ sessionID: enhancementSessionId }).catch(() => undefined);
      }
    },
  });
}
