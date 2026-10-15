import type { ModelInfo } from "@/types";

/**
 * A model's user-facing spec sheet, derived from the provider's own
 * `limit` / `capabilities` fields so the UI shows the exact numbers the
 * provider reports instead of guessing from the model's name.
 */
export interface ModelSpecs {
  model: string;
  provider: string;
  /** Input modalities the model accepts, e.g. ["text", "image"]. */
  inputs: string[];
  /** Whether the model can reason/think; undefined when the provider is silent. */
  reasoning?: boolean;
  /** The model's context window in tokens, when the provider reports it. */
  contextWindow?: number;
  /** The model's maximum output in tokens, when the provider reports it. */
  outputLimit?: number;
}

const INPUT_MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;

function positive(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The model matching an OpenCode `provider/model` key, or its bare id. */
export function findModelInfo(
  modelId: string | undefined,
  allModels: readonly ModelInfo[],
): ModelInfo | undefined {
  if (!modelId) return undefined;
  return (
    allModels.find((model) => `${model.providerId}/${model.id}` === modelId) ??
    allModels.find((model) => model.id === modelId)
  );
}

/**
 * Builds the spec sheet for a model. Falls back to `text` (plus `image` when
 * the provider marks the model as an attachment-capable one) when the server
 * does not send per-modality input flags.
 */
export function modelSpecs(model?: ModelInfo | null): ModelSpecs | null {
  if (!model) return null;
  const input = model.capabilities?.input;
  const reported = input ? INPUT_MODALITIES.filter((modality) => input[modality] === true) : [];
  const inputs: string[] =
    reported.length > 0 ? reported : model.capabilities?.attachment ? ["text", "image"] : ["text"];
  return {
    model: model.name,
    provider: model.providerName,
    inputs,
    reasoning: model.capabilities?.reasoning,
    contextWindow: positive(model.limit?.context),
    outputLimit: positive(model.limit?.output),
  };
}

/** 200000 -> "200,000". Returns undefined when the value is unknown. */
export function formatTokens(value?: number): string | undefined {
  return positive(value)?.toLocaleString("en-US");
}

/** Human-readable reasoning state for the specs HUD. */
export function reasoningLabel(reasoning?: boolean): string {
  if (reasoning === undefined) return "Unknown";
  return reasoning ? "Allows reasoning" : "No reasoning";
}

// ── Context window resolution ───────────────────────────────────────────

/**
 * Well-known context windows, used only when the provider does not report
 * one. Matched against the model's id and name, so the longer keys must come
 * first (a "gpt-5.4-mini" match wins over "gpt-5.4").
 */
const KNOWN_CAPACITIES: Record<string, number> = {
  "gpt-5.4-mini": 400_000,
  "gpt-5.4": 400_000,
  "deepseek-v4": 1_000_000,
  fable: 1_000_000,
  "nemotron-3-ultra": 1_000_000,
  "haiku-4.5": 200_000,
  laguna: 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3": 200_000,
  "claude-3.5": 200_000,
  claude: 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-2.0": 1_000_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

function lookupKnownModel(modelId: string, modelName: string): number | undefined {
  const text = `${modelId.toLowerCase()} ${modelName.toLowerCase()}`;
  for (const [key, capacity] of Object.entries(KNOWN_CAPACITIES)) {
    if (text.includes(key)) return capacity;
  }
  const baseId = modelId.split("/").pop()?.toLowerCase();
  if (baseId && KNOWN_CAPACITIES[baseId]) return KNOWN_CAPACITIES[baseId];
  return undefined;
}

/** Boundary-aware "32k" / "1m" suffix parser. */
function parseContextWindowFromId(modelId?: string): number | undefined {
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

/**
 * The model's context window: the provider's own `limit.context` first, then
 * local knowledge of well-known models, then a size encoded in the model's
 * name/id, and finally a conservative default.
 */
export function resolveContextWindow(
  modelId: string | undefined,
  allModels: readonly ModelInfo[],
): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;

  const match = findModelInfo(modelId, allModels);

  if (match) {
    const reported = positive(match.limit?.context);
    if (reported !== undefined) return reported;

    const known = lookupKnownModel(match.id, match.name);
    if (known !== undefined) return known;

    const fromId = parseContextWindowFromId(match.id);
    if (fromId !== undefined) return fromId;

    const fromName = parseContextWindowFromId(match.name);
    if (fromName !== undefined) return fromName;
  }

  // No model matched: still honour an explicit size encoded in the key, or a
  // well-known family, so the window is right even before the list loads.
  const fromRaw = parseContextWindowFromId(modelId);
  if (fromRaw !== undefined) return fromRaw;

  const knownRaw = lookupKnownModel(modelId, modelId);
  if (knownRaw !== undefined) return knownRaw;

  return DEFAULT_CONTEXT_WINDOW;
}
