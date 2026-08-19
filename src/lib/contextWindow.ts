// ── Context window resolution ──────────────────────────────────────────────
// Pure helpers extracted from ContextUsageIndicator so they can be tested
// independently of React rendering.

// Ordered list — first match wins when iterating Object.entries.
const KNOWN_CAPACITIES: Record<string, number> = {
  "gpt-5.4-mini": 400_000,
  "gpt-5.4": 400_000,
  deepseek: 1_000_000,
  "deepseek-v4": 1_000_000,
  fable: 1_000_000,
  "nemotron-3-ultra": 1_000_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-2.0": 1_000_000,
  haiku: 200_000,
  "haiku-4.5": 200_000,
  laguna: 200_000,
  claude: 200_000,
  "claude-3": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3.5-sonnet": 200_000,
};

/** Look up a known model capacity by substring match on id + name, then base-id fallback. */
export function lookupKnownModel(modelId: string, modelName: string): number | undefined {
  const text = `${modelId.toLowerCase()} ${modelName.toLowerCase()}`;
  for (const [key, capacity] of Object.entries(KNOWN_CAPACITIES)) {
    if (text.includes(key)) return capacity;
  }
  const baseId = modelId.split("/").pop()?.toLowerCase();
  if (baseId && KNOWN_CAPACITIES[baseId]) return KNOWN_CAPACITIES[baseId];
  return undefined;
}

/** Extract a context-window size from a model identifier like "128k" or "1m". */
export function parseContextWindowFromId(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  const lower = modelId.toLowerCase();

  const kMatch = lower.match(/\b(\d+)\s*k\b/);
  if (kMatch) {
    const num = Number.parseInt(kMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000;
  }

  const mMatch = lower.match(/\b(\d+)\s*m\b/);
  if (mMatch) {
    const num = Number.parseInt(mMatch[1], 10);
    if (!Number.isNaN(num) && num > 0) return num * 1_000_000;
  }

  return undefined;
}

/** Resolve a model's context window: known table → regex on id → regex on name → default. */
export function resolveContextWindow(
  modelId: string | undefined,
  allModels: { providerId: string; id: string; name: string }[],
): number {
  if (!modelId) return 128_000;

  const match = allModels.find((m) => `${m.providerId}/${m.id}` === modelId || m.id === modelId);

  if (match) {
    const known = lookupKnownModel(match.id, match.name);
    if (known !== undefined) return known;

    const fromId = parseContextWindowFromId(match.id);
    if (fromId !== undefined) return fromId;

    const fromName = parseContextWindowFromId(match.name);
    if (fromName !== undefined) return fromName;
  }

  const fromRaw = parseContextWindowFromId(modelId);
  if (fromRaw !== undefined) return fromRaw;

  return 128_000;
}
