import {
  parseEnhancedText,
  resolveEnhancedObject,
  resolveEnhancedText,
  TEXT_ENHANCEMENT_SCHEMA,
} from "./enhancePrompt";

export type AnimationRig = "r15" | "r6" | "both";

export type AnimationKind =
  | "combat combo"
  | "hit reaction"
  | "dance loop"
  | "emote"
  | "eat/drink"
  | "custom";

export interface AnimationRequest {
  brief: string;
  kind: AnimationKind;
  rig: AnimationRig;
  duration: string;
  loop: boolean;
  beats: string[];
  notes: string;
}

export const ANIMATION_KINDS: readonly { id: AnimationKind; label: string; hint: string }[] = [
  {
    id: "combat combo",
    label: "Combat combo",
    hint: "wind-up, impact, recovery, and chain windows",
  },
  {
    id: "hit reaction",
    label: "Hit reaction",
    hint: "flinch, stagger, or knockback timing",
  },
  {
    id: "dance loop",
    label: "Dance loop",
    hint: "seamless looping movement matched to a beat",
  },
  {
    id: "emote",
    label: "Emote",
    hint: "short expressive loop or one-off gesture",
  },
  {
    id: "eat/drink",
    label: "Eat / drink",
    hint: "tool-to-mouth alignment and idle hold pose",
  },
  {
    id: "custom",
    label: "Custom",
    hint: "any animation that needs a tailored motion plan",
  },
];

export const ANIMATION_RIGS: readonly { id: AnimationRig; label: string; hint: string }[] = [
  { id: "r15", label: "R15", hint: "modern 15-joint avatar rig" },
  { id: "r6", label: "R6", hint: "classic 6-joint avatar rig" },
  { id: "both", label: "Both", hint: "author rig-specific variants for both rigs" },
];

export function animationKindOption(kind: AnimationKind) {
  return ANIMATION_KINDS.find((option) => option.id === kind) ?? ANIMATION_KINDS[0];
}

export function animationRigOption(rig: AnimationRig) {
  return ANIMATION_RIGS.find((option) => option.id === rig) ?? ANIMATION_RIGS[0];
}

export function formatAnimationPrompt(request: AnimationRequest): string {
  const kind = animationKindOption(request.kind);
  const rig = animationRigOption(request.rig);
  const lines = [
    "Create the requested Roblox animation in the currently connected Studio experience.",
    "The required animation reference is already in your system prompt. Load the `roblox-animation` and `roblox-animation-runtime` skills only if they are available; if a skill reports 'not found', proceed with the embedded reference and do not stop. Then author the motion as a KeyframeSequence and verify playback in Studio.",
    `Animation brief: ${request.brief.trim()}`,
    `Type: ${kind.label} - ${kind.hint}.`,
    `Rig target: ${rig.label} - ${rig.hint}.`,
    `Loop: ${request.loop ? "yes" : "no"}.`,
  ];

  if (request.duration.trim()) lines.push(`Duration: ${request.duration.trim()}`);
  if (request.beats.length > 0) {
    lines.push(`Key beats: ${request.beats.map((beat) => beat.trim()).join(" | ")}`);
  }
  if (request.notes.trim()) lines.push(`Notes: ${request.notes.trim()}`);

  lines.push(
    [
      "Execution rules:",
      "1. Build the motion as programmatic KeyframeSequence data, not as an uploaded asset.",
      "2. Prefer rig-specific variants when the request mentions both rigs.",
      "3. Start from neutral pose, include anticipation and recovery, and keep the timing readable.",
      "4. Verify playback in Studio by loading it on the active rig and watching the result.",
      "5. Report the final rig, the key beats used, and any limits or follow-up needed.",
    ].join("\n"),
  );

  return lines.join("\n\n");
}

export const ANIMATION_BRIEF_ENHANCEMENT_SCHEMA = TEXT_ENHANCEMENT_SCHEMA;

export function parseEnhancedAnimationBrief(value: unknown): string {
  return parseEnhancedText(value, "animation");
}

export function resolveEnhancedAnimationBrief(
  info: Parameters<typeof resolveEnhancedText>[0],
  parts: Parameters<typeof resolveEnhancedText>[1],
): string {
  return resolveEnhancedText(info, parts, "animation");
}

export const ANIMATION_FIELDS_ENHANCEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brief", "duration", "beats", "notes"],
  properties: {
    brief: { type: "string", minLength: 1 },
    duration: { type: "string" },
    beats: { type: "string" },
    notes: { type: "string" },
  },
} as const;

export function parseEnhancedAnimationFields(value: unknown) {
  return resolveEnhancedObject({ structured: value }, undefined);
}

export function resolveEnhancedAnimationFields(
  info: Parameters<typeof resolveEnhancedObject>[0],
  parts: Parameters<typeof resolveEnhancedObject>[1],
) {
  return resolveEnhancedObject(info, parts);
}
