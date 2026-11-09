/**
 * OC2 (v2.2.6) removed the `StructuredOutput` tool and the `info.structured`
 * field BloxMind used for hidden, tool-free turns. BloxMind now asks the model
 * for a JSON document and parses it out of the assistant's text (the adapter
 * also appends a schema instruction to the prompt for `format: json_schema`).
 */

export class StructuredOutputError extends Error {}

/** Parse a JSON document out of free text: fences win over balanced objects/arrays. */
export function parseJsonFromText(text: string): unknown | undefined {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fence?.[1] ?? text).trim();
  const direct = tryParseJson(candidate);
  if (direct.ok) return direct.value;
  for (let start = 0; start < candidate.length; start++) {
    const open = candidate[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index++) {
      const char = candidate[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === open) depth++;
      else if (char === close) {
        depth--;
        if (depth === 0) {
          const parsed = tryParseJson(candidate.slice(start, index + 1));
          if (parsed.ok) return parsed.value;
          break;
        }
      }
    }
  }
  return undefined;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The parsed JSON document from an assistant reply in OC1-shaped `{ parts }` form,
 * as returned by `client.session.prompt`. Throws `StructuredOutputError` when the
 * reply contains no parseable JSON value.
 */
export function extractStructuredOutput(response: unknown): unknown {
  const data =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const parts = Array.isArray((data as { parts?: unknown }).parts)
    ? (data as { parts: Array<{ type?: string; text?: string }> }).parts
    : [];
  const text = parts
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  if (!text) throw new StructuredOutputError("The model returned no text.");
  const parsed = parseJsonFromText(text);
  if (parsed === undefined) {
    throw new StructuredOutputError("The model's reply did not contain a JSON document.");
  }
  return parsed;
}
