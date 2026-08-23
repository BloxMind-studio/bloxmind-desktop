import { parseEnhancedText, resolveEnhancedText, TEXT_ENHANCEMENT_SCHEMA } from "./enhancePrompt";
export type MeshStyle = "blocky" | "low-poly" | "cartoon" | "realistic";

export interface MeshStyleOption {
  id: MeshStyle;
  label: string;
  hint: string;
}

export const MESH_STYLES: readonly MeshStyleOption[] = [
  {
    id: "blocky",
    label: "Blocky",
    hint: "chunky primitive shapes that match classic R6 aesthetics",
  },
  {
    id: "low-poly",
    label: "Low-poly",
    hint: "simple faceted geometry with clean silhouettes",
  },
  {
    id: "cartoon",
    label: "Cartoon",
    hint: "stylized exaggerated shapes with bright colors",
  },
  {
    id: "realistic",
    label: "Realistic",
    hint: "detailed organic or hard-surface shapes",
  },
];

export interface MeshRequest {
  brief: string;
  style: MeshStyle;
  maxSize: string;
  segments: string[];
}

export function meshStyleOption(style: MeshStyle): MeshStyleOption {
  return MESH_STYLES.find((option) => option.id === style) ?? MESH_STYLES[0];
}

export function formatMeshPrompt(request: MeshRequest): string {
  const style = meshStyleOption(request.style);
  const lines = [
    "Generate an AI textured mesh in the currently connected Roblox Studio experience using the `generate_mesh` tool, then verify it.",
    `Mesh brief: ${request.brief.trim()}`,
    `Style: ${style.label} — ${style.hint}.`,
  ];
  if (request.maxSize.trim()) lines.push(`Approximate size: ${request.maxSize.trim()}`);
  lines.push(
    request.segments.length > 0
      ? `Segments: name the generated parts ${request.segments.join(", ")}.`
      : "Segments: none — generate a single mesh.",
  );
  lines.push(
    [
      "Execution rules:",
      "1. Call `generate_mesh` exactly once with the description above.",
      '2. Mesh generation can take several minutes. If the call returns "MCP error -32001: Request timed out", treat it as still running, not failed.',
      "3. After a timeout, check whether the mesh appeared anyway (console output plus a workspace search) before doing anything else.",
      "4. Only call `generate_mesh` again if the check confirms nothing was created; retry at most twice and simplify the description each time.",
      "5. Once the mesh exists, inspect it briefly, make sure it is parented sensibly, and report the result.",
    ].join("\n"),
  );
  return lines.join("\n\n");
}

export const MESH_BRIEF_ENHANCEMENT_SCHEMA = TEXT_ENHANCEMENT_SCHEMA;

export function parseEnhancedMeshBrief(value: unknown): string {
  return parseEnhancedText(value, "mesh");
}

export function resolveEnhancedMeshBrief(
  info: Parameters<typeof resolveEnhancedText>[0],
  parts: Parameters<typeof resolveEnhancedText>[1],
): string {
  return resolveEnhancedText(info, parts, "mesh");
}
