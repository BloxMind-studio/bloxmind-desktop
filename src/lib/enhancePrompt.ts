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
 * Pulls a JSON object out of a value even when it is embedded in a larger
 * prose string (`"Here is your brief:\n{...}\n"`). Schema-less models often
 * wrap their structured answer in a sentence or two, which makes a plain
 * `JSON.parse` of the whole text fail; finding the first `{` to the last `}`
 * and parsing just that slice recovers the object. Also turns a JSON string
 * held in `info.structured` into a real object.
 */
function extractEmbeddedJsonObject(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return value;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return value;
  }
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

/** Turns a single value into a short string for a field: arrays become a
 *  comma-joined list, numbers and booleans become text. Blank/null are dropped
 *  so a field the model left empty is not overwritten. */
function stringifyFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)).trim())
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : null;
  }
  return null;
}

/**
 * Recognized field labels (lowercased) used by the keyed-line fallback for
 * schema-less models. Each maps to the field key the panels consume.
 */
const FIELD_LABELS: Record<string, string> = {
  brief: "brief",
  description: "brief",
  idea: "brief",
  "player count": "playerCount",
  players: "playerCount",
  "traversal time": "traversalTime",
  "theme pillars": "themePillars",
  landmarks: "landmarks",
  landmark: "landmarks",
  zones: "zones",
  zone: "zones",
  notes: "notes",
  note: "notes",
  duration: "duration",
  "key beats": "beats",
  beats: "beats",
  beat: "beats",
};

/** Fallback used when a schema-less model answered in prose that labels each
 *  value, e.g. `player count: 4v4`. Each recognized line fills its field;
 *  unrecognized/blank lines are skipped. */
function parseKeyedLines(text: string): EnhancedFieldsRecord {
  const record: EnhancedFieldsRecord = {};
  const key = (raw: string) => raw.toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const label = key(line.slice(0, colon));
    if (!FIELD_LABELS[label]) continue;
    const value = line.slice(colon + 1).trim();
    if (!value) continue;
    record[FIELD_LABELS[label]] = value;
  }
  return record;
}

/** Match a field key to a canonical panel key (e.g. `theme_pillars` ->
 *  `themePillars`), so snake_case keys still fill the UI. */
function canonicalFieldKey(key: string): string | null {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  for (const label of Object.keys(FIELD_LABELS)) {
    if (normalized === label.replace(/[-_\s]/g, "")) return FIELD_LABELS[label];
  }
  if (/^[a-z][a-zA-Z0-9]*$/.test(key) && key !== "description") return key;
  return null;
}

function normalize(value: unknown, fields?: string[]): EnhancedFieldsRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record: EnhancedFieldsRecord = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const fieldKey = canonicalFieldKey(key);
      if (!fieldKey) continue;
      const serialized = stringifyFieldValue(entry);
      if (!serialized) continue;
      if (fields && !fields.includes(fieldKey)) continue;
      record[fieldKey] = serialized;
    }
    return record;
  }
  return {};
}

/**
 * Like `resolveEnhancedText`, but for a multi-field enhancement: the schema
 * returns an object of short values (strings or arrays), one per panel field,
 * and the resolver normalizes structured output / JSON-in-text /
 * <structured_output> / keyed-line prose into an `EnhancedFieldsRecord`.
 */
export function resolveEnhancedObject<F extends string>(
  info:
    | { structured?: unknown; error?: { name?: string; data?: { message?: string } } }
    | undefined,
  parts: Array<{ type: string; text?: unknown }> | undefined,
  fields?: readonly F[],
): EnhancedFieldsRecord {
  const fieldKeys = fields ? [...fields] : undefined;
  const accept = (entry: EnhancedFieldsRecord): EnhancedFieldsRecord | null => {
    if (fieldKeys) {
      for (const key of Object.keys(entry)) {
        if (!fieldKeys.includes(key as F)) delete entry[key];
      }
    }
    return Object.keys(entry).length > 0 ? entry : null;
  };

  if (info?.structured !== undefined) {
    const structured = accept(normalize(extractEmbeddedJsonObject(info.structured), fieldKeys));
    if (structured) return structured;
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
      const parsed = accept(normalize(JSON.parse(candidateText), fieldKeys));
      if (parsed) return parsed;
    } catch {
      // Not JSON (or not the expected shape) - try the next candidate.
    }
    // Schema-less models often wrap the JSON in prose; parse the object that
    // sits inside the text so multi-field enhancement still works.
    const extracted = extractEmbeddedJsonObject(candidateText);
    if (extracted !== candidateText) {
      const parsed = accept(normalize(extracted, fieldKeys));
      if (parsed) return parsed;
    }
  }

  // Schema-less models often answer as labeled lines that fill multiple fields;
  // use those before collapsing to a lone brief.
  const keyed = accept(parseKeyedLines(unwrapped));
  if (keyed) return keyed;

  // Absolute fallback: plain prose rewrite of the whole request.
  return { brief: unwrapped };
}
