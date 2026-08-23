import { useMutation } from "@tanstack/react-query";
import {
  ANIMATION_BRIEF_ENHANCEMENT_SCHEMA,
  type AnimationKind,
  type AnimationRig,
  animationKindOption,
  animationRigOption,
  resolveEnhancedAnimationBrief,
} from "@/lib/animationRequest";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useModelPreferences } from "@/providers/PreferencesProvider";

export interface EnhanceAnimationBriefInput {
  brief: string;
  kind: AnimationKind;
  rig: AnimationRig;
}

export function useEnhanceAnimationBrief() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedAgent, selectedVariant } = useModelPreferences();

  return useMutation({
    mutationFn: async ({ brief, kind, rig }: EnhanceAnimationBriefInput) => {
      if (!client || !activeSessionId) {
        throw new Error("Open a chat before enhancing an animation brief.");
      }
      if (!brief.trim()) throw new Error("Describe the animation before enhancing it.");

      let model: { providerID: string; modelID: string } | undefined;
      if (selectedModel) {
        const [providerID, modelID] = splitModelKey(selectedModel);
        if (providerID && modelID) model = { providerID, modelID };
      }

      const created = await client.session.create(
        {
          title: "Animation brief enhancement (temporary)",
          agent: selectedAgent ?? undefined,
          permission: [{ permission: "*", pattern: "*", action: "deny" }],
        },
        { throwOnError: true },
      );
      const enhancementSessionId = created.data?.id;
      if (!enhancementSessionId) throw new Error("Couldn't start the animation brief enhancer.");

      try {
        const kindOption = animationKindOption(kind);
        const rigOption = animationRigOption(rig);
        const response = await client.session.prompt(
          {
            sessionID: enhancementSessionId,
            model,
            agent: selectedAgent ?? undefined,
            variant: selectedVariant ?? undefined,
            format: {
              type: "json_schema",
              schema: ANIMATION_BRIEF_ENHANCEMENT_SCHEMA,
              retryCount: 2,
            },
            system:
              "You rewrite short ideas into precise prompts for authoring Roblox character animations. Return only the requested structured data. Never call tools and never modify files or Roblox Studio.",
            parts: [
              {
                type: "text",
                text: `Rewrite the animation idea below into one detailed animation brief (2-4 sentences) for a Roblox character animation of type "${kindOption.label}" (${kindOption.hint}) targeting the ${rigOption.label} rig (${rigOption.hint}). Describe the key poses, timing, anticipation, follow-through, mood, and any loop/beat requirements. Do not mention Roblox tools.\n\nIDEA\n${brief.trim()}`,
              },
            ],
          },
          { throwOnError: true },
        );
        return resolveEnhancedAnimationBrief(response.data?.info, response.data?.parts);
      } finally {
        await client.session.delete({ sessionID: enhancementSessionId }).catch(() => undefined);
      }
    },
  });
}
