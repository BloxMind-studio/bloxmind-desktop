import { useMutation } from "@tanstack/react-query";
import {
  ANIMATION_FIELDS_ENHANCEMENT_SCHEMA,
  type AnimationKind,
  type AnimationRig,
  animationKindOption,
  animationRigOption,
  resolveEnhancedAnimationFields,
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
          metadata: { BloxMindHidden: true, purpose: "enhance" },
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
              schema: ANIMATION_FIELDS_ENHANCEMENT_SCHEMA,
              retryCount: 2,
            },
            system:
              "You expand short ideas into a complete, detailed Roblox character animation brief. Return the requested JSON. Never call tools and never modify files or Roblox Studio.",
            parts: [
              {
                type: "text",
                text: `Expand the animation idea below into a full brief for a Roblox character animation of type "${kindOption.label}" (${kindOption.hint}) targeting the ${rigOption.label} rig (${rigOption.hint}). Fill EVERY field: rewrite the brief as a concrete 2-4 sentence motion description (key poses, mood, feel); propose a duration; list key beats; and make notes covering timing, anticipation, follow-through, loop, and rig constraints. Be specific and actionable.\n\nIDEA\n${brief.trim()}`,
              },
            ],
          },
          { throwOnError: true },
        );
        return resolveEnhancedAnimationFields(response.data?.info, response.data?.parts);
      } finally {
        await client.session.delete({ sessionID: enhancementSessionId }).catch(() => undefined);
      }
    },
  });
}
