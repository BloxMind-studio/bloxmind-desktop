import {
  parseEnhancedText,
  resolveEnhancedObject,
  resolveEnhancedText,
  TEXT_ENHANCEMENT_SCHEMA,
} from "./enhancePrompt";

export type MapMode = "arena" | "obby" | "showcase" | "hub" | "tycoon" | "roleplay" | "custom";

export interface MapRequest {
  brief: string;
  mode: MapMode;
  playerCount: string;
  traversalTime: string;
  themePillars: string[];
  landmarks: string[];
  zones: string[];
  notes: string;
}

export const MAP_MODES: readonly { id: MapMode; label: string; hint: string }[] = [
  { id: "arena", label: "Arena", hint: "competitive loop with clear combat flow" },
  { id: "obby", label: "Obby", hint: "clear progression and readable jumps" },
  { id: "showcase", label: "Showcase", hint: "visually guided tour through a space" },
  { id: "hub", label: "Hub", hint: "central social space with branching routes" },
  { id: "tycoon", label: "Tycoon", hint: "looped progression and upgrade zones" },
  { id: "roleplay", label: "Roleplay", hint: "explorable neighborhood or themed world" },
  { id: "custom", label: "Custom", hint: "any world that needs a structured plan" },
];

export function mapModeOption(mode: MapMode) {
  return MAP_MODES.find((option) => option.id === mode) ?? MAP_MODES[0];
}

function list(value: string[]): string {
  return value.length > 0
    ? value
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ")
    : "none";
}

export function formatMapPrompt(request: MapRequest): string {
  const mode = mapModeOption(request.mode);
  const lines = [
    "Plan the requested Roblox map in the currently connected Studio experience.",
    "The required map-building reference is already in your system prompt. Load the `roblox-map-planning` skill if it is available, then present the written build plan before any building starts; if the skill reports 'not found', proceed with the embedded reference.",
    "If the plan is approved, load `roblox-map-building` if it is available and build phase by phase from the plan; if it reports 'not found', proceed with the embedded reference and do not stop.",
    `Map brief: ${request.brief.trim()}`,
    `Mode: ${mode.label} - ${mode.hint}.`,
    `Player count: ${request.playerCount.trim() || "not specified"}.`,
    `Traversal time: ${request.traversalTime.trim() || "not specified"}.`,
    `Theme pillars: ${list(request.themePillars)}.`,
    `Landmarks: ${list(request.landmarks)}.`,
    `Zones: ${list(request.zones)}.`,
  ];

  if (request.notes.trim()) lines.push(`Notes: ${request.notes.trim()}`);

  lines.push(
    [
      "Execution rules:",
      "1. Write the structured plan using the skill's required format first.",
      "2. Include zone names, flow, scale notes, phase order, and budgets.",
      "3. Do not begin blockout until the plan is clearly presented and acknowledged.",
      "4. Keep the primary route readable and align the world to the stated scale.",
      "5. When building, work zone by zone and verify each phase before the next.",
    ].join("\n"),
  );

  return lines.join("\n\n");
}

export const MAP_BRIEF_ENHANCEMENT_SCHEMA = TEXT_ENHANCEMENT_SCHEMA;

export function parseEnhancedMapBrief(value: unknown): string {
  return parseEnhancedText(value, "map");
}

export function resolveEnhancedMapBrief(
  info: Parameters<typeof resolveEnhancedText>[0],
  parts: Parameters<typeof resolveEnhancedText>[1],
): string {
  return resolveEnhancedText(info, parts, "map");
}

export const MAP_FIELDS_ENHANCEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "brief",
    "playerCount",
    "traversalTime",
    "themePillars",
    "landmarks",
    "zones",
    "notes",
  ],
  properties: {
    brief: { type: "string", minLength: 1 },
    playerCount: { type: "string" },
    traversalTime: { type: "string" },
    themePillars: { type: "string" },
    landmarks: { type: "string" },
    zones: { type: "string" },
    notes: { type: "string" },
  },
} as const;

export function parseEnhancedMapFields(value: unknown) {
  return resolveEnhancedObject({ structured: value }, undefined);
}

export function resolveEnhancedMapFields(
  info: Parameters<typeof resolveEnhancedObject>[0],
  parts: Parameters<typeof resolveEnhancedObject>[1],
) {
  return resolveEnhancedObject(info, parts);
}
