/** Split a "providerID/modelID" string on the first "/" only.
 *  OpenRouter model IDs contain slashes (e.g. "anthropic/claude-3.5-sonnet"),
 *  so naive split("/") breaks them. */
export function splitModelKey(key: string): [string, string] {
  const idx = key.indexOf("/");
  if (idx < 0) return [key, ""];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
