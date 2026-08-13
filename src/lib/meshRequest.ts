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

export const MESH_BRIEF_ENHANCEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description"],
  properties: {
    description: { type: "string", minLength: 1 },
  },
} as const;

export function parseEnhancedMeshBrief(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The enhancer returned an invalid mesh description.");
  }
  const candidate = value as Record<string, unknown>;
  // The schema asks for "description", but models without schema mode often
  // rename the field (commonly "prompt"); accept known aliases, then fall back
  // to the lone string property when exactly one exists.
  let description = "";
  for (const key of ["description", "prompt", "text"]) {
    const entry = candidate[key];
    if (typeof entry === "string" && entry.trim()) {
      description = entry.trim();
      break;
    }
  }
  if (!description) {
    const stringValues = Object.values(candidate).filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (stringValues.length === 1) description = stringValues[0].trim();
  }
  if (!description) throw new Error("The enhancer returned an empty mesh description.");
  return description;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * OpenCode asks schema-less models to wrap their JSON in literal
 * `<structured_output>` tags; when extraction fails those tags leak into the
 * text parts, so unwrap them before attempting to parse.
 */
function unwrapStructuredOutputTag(text: string): string {
  const match = text.match(/<structured_output>\s*([\s\S]*?)\s*<\/structured_output>/i);
  return match ? match[1].trim() : text;
}

/**
 * Resolve the enhanced brief from a prompt response. Structured output is
 * preferred, but providers without schema-mode support leave `structured`
 * undefined (sometimes with a StructuredOutputError on the message) while the
 * raw text still holds the answer, so fall back to parsing the text parts.
 */
export function resolveEnhancedMeshBrief(
  info:
    | { structured?: unknown; error?: { name?: string; data?: { message?: string } } }
    | undefined,
  parts: Array<{ type: string; text?: unknown }> | undefined,
): string {
  if (info?.structured !== undefined) return parseEnhancedMeshBrief(info.structured);

  const text = (parts ?? [])
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    )
    .map((part) => part.text.trim())
    .join("\n")
    .trim();

  if (!text) {
    if (info?.error?.name === "StructuredOutputError") {
      const detail = info.error.data?.message;
      throw new Error(
        `The model couldn't produce structured output${detail ? ` (${detail})` : ""}. Try a different model for Enhance.`,
      );
    }
    throw new Error("The enhancer returned an empty response.");
  }

  const unwrapped = unwrapStructuredOutputTag(text);
  const candidates = [
    ...new Set([unwrapped, stripCodeFence(unwrapped), text, stripCodeFence(text)]),
  ];
  for (const candidateText of candidates) {
    try {
      return parseEnhancedMeshBrief(JSON.parse(candidateText));
    } catch {
      // Not JSON (or not the expected shape) — try the next candidate.
    }
  }

  // Last resort: the model answered in plain prose despite the schema; the
  // rewrite itself is still usable as the enhanced brief.
  return unwrapped;
}
