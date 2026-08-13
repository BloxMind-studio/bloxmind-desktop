import { useMutation } from "@tanstack/react-query";
import {
  MESH_BRIEF_ENHANCEMENT_SCHEMA,
  type MeshStyle,
  meshStyleOption,
  resolveEnhancedMeshBrief,
} from "@/lib/meshRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

export interface EnhanceMeshBriefInput {
  brief: string;
  style: MeshStyle;
}

export function useEnhanceMeshBrief() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();

  return useMutation({
    mutationFn: async ({ brief, style }: EnhanceMeshBriefInput) => {
      if (!client || !activeSessionId) {
        throw new Error("Open a chat before enhancing a mesh brief.");
      }
      if (!brief.trim()) throw new Error("Describe the mesh before enhancing it.");

      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      const created = await client.session.create(
        {
          title: "Mesh brief enhancement (temporary)",
          agent: selectedAgent ?? undefined,
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        },
        { throwOnError: true },
      );
      const enhancementSessionId = created.data?.id;
      if (!enhancementSessionId) throw new Error("Couldn't start the mesh brief enhancer.");

      try {
        const styleOption = meshStyleOption(style);
        const response = await client.session.prompt(
          {
            sessionID: enhancementSessionId,
            model,
            agent: selectedAgent ?? undefined,
            variant: selectedVariant ?? undefined,
            format: {
              type: "json_schema",
              schema: MESH_BRIEF_ENHANCEMENT_SCHEMA,
              retryCount: 2,
            },
            system:
              "You rewrite short ideas into precise prompts for Roblox Studio's AI mesh generator. Return only the requested structured data. Never call tools and never modify files or Roblox Studio.",
            parts: [
              {
                type: "text",
                text: `Rewrite the mesh idea below into one detailed, visual generation prompt (2-4 sentences) in the "${styleOption.label}" style (${styleOption.hint}). Describe shape, proportions, colors, materials, and standout features. Do not mention Roblox tools or sizes in studs.\n\nIDEA\n${brief.trim()}`,
              },
            ],
          },
          { throwOnError: true },
        );
        return resolveEnhancedMeshBrief(response.data?.info, response.data?.parts);
      } finally {
        await client.session.delete({ sessionID: enhancementSessionId }).catch(() => undefined);
      }
    },
  });
}
