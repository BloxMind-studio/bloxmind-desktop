/**
 * Shared helpers for the "Enhance with AI" brief rewrites used by the mesh,
 * map, and animation panels. Every feature calls OpenCode's `session.prompt`
 * with a throwaway session and a `json_schema` format; these helpers own the
 * schema and the messy business of resolving the model's answer (structured
 * output first, then JSON-in-text, then plain prose).
 *
 * OpenCode asks schema-less models to wrap their JSON in literal
 * `<structured_output>` tags; when extraction fails those tags leak into the
 * text parts, so the resolvers unwrap them before attempting to parse.
 */

export const TEXT_ENHANCEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description"],
  properties: {
    description: { type: "string", minLength: 1 },
  },
} as const;

/** Throws when the model's answer cannot be turned into a non-empty string. */
export function parseEnhancedText(value: unknown, label: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The enhancer returned an invalid ${label} description.`);
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
  if (!description) throw new Error(`The enhancer returned an empty ${label} description.`);
  return description;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

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
export function resolveEnhancedText(
  info:
    | { structured?: unknown; error?: { name?: string; data?: { message?: string } } }
    | undefined,
  parts: Array<{ type: string; text?: unknown }> | undefined,
  label: string,
): string {
  if (info?.structured !== undefined) return parseEnhancedText(info.structured, label);

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
      return parseEnhancedText(JSON.parse(candidateText), label);
    } catch {
      // Not JSON (or not the expected shape) â€” try the next candidate.
    }
  }

  // Last resort: the model answered in plain prose despite the schema; the
  // rewrite itself is still usable as the enhanced brief.
  return unwrapped;
}
/** Result of an enhancement that may fill any number of the various panel
 * fields, not just the brief. Empty values are dropped by the resolver so
 * the caller can decide whether to overwrite a field. */
export interface EnhancedFieldsRecord {
  [field: string]: string;
}

/**
 * Like `resolveEnhancedText`, but for a multi-field enhancement: the schema
 * returns an object of short strings (one per editable panel field) and the
 * resolver normalizes structured output / JSON-in-text / <structured_output>
 * wraps into an `EnhancedFieldsRecord`. Falls back to treating the whole
 * answer as a single `brief` when the model ignores the schema entirely.
 */
export function resolveEnhancedObject(
  info:
    | { structured?: unknown; error?: { name?: string; data?: { message?: string } } }
    | undefined,
  parts: Array<{ type: string; text?: unknown }> | undefined,
): EnhancedFieldsRecord {
  const normalize = (value: unknown): EnhancedFieldsRecord => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record: EnhancedFieldsRecord = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === "string" && entry.trim()) record[key] = entry.trim();
      }
      return record;
    }
    return {};
  };

  if (info?.structured !== undefined) {
    const structured = normalize(info.structured);
    if (Object.keys(structured).length > 0) return structured;
  }

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
      const parsed = normalize(JSON.parse(candidateText));
      if (Object.keys(parsed).length > 0) return parsed;
    } catch {
      // Not JSON (or not the expected shape) - try the next candidate.
    }
  }

  // Last resort: the model wrote a plain prose rewrite of the whole request;
  // treat it as the brief so the enhancement still lands in the UI.
  return { brief: unwrapped };
}
