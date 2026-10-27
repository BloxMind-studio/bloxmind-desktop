import type { Config, OpencodeClient } from "@opencode-ai/sdk/v2/client";

import { splitModelKey } from "@/lib/splitModelKey";

// Pushes Settings → AI Engine values into OpenCode's global configuration so
// the engine actually honors them. Temperature and max output tokens have no
// prompt-level field: they live in the agent and model config, so they are
// applied through the config update endpoint instead.
//
// Verified against the local 1.19.x server: the update deep-merges this
// payload into the app-managed opencode.json, hot-applies it to running
// sessions, and `null` values remove keys written by an earlier update.

/** One model as surfaced by `provider.list`, reduced to what the patch needs. */
export interface EngineModelInfo {
  name?: string;
  limit?: { context?: number; output?: number };
}

/** One provider as surfaced by `provider.list`, reduced to what the patch needs. */
export interface EngineProviderInfo {
  id: string;
  models: Record<string, EngineModelInfo>;
}

/** The Settings → AI Engine values to push into the server config. */
export interface EngineSettingsInput {
  temperature: number;
  /** Output-token cap for the selected model; `0` leaves the model's own limit. */
  maxTokens: number;
  /** Whether OpenCode summarizes older messages when the context window fills up. */
  autoCompaction?: boolean;
  customApiEndpoint: string | null;
  agent: string | null;
  modelKey: string | null;
}

interface EngineModelPatch {
  name?: string;
  limit?: { context: number; output: number } | null;
}

interface EngineProviderPatch {
  options?: { baseURL: string | null };
  /** `null` drops every model override written by an earlier update. */
  models?: Record<string, EngineModelPatch> | null;
}

interface EngineConfigPatch {
  agent?: Record<string, { temperature: number }>;
  provider?: Record<string, EngineProviderPatch>;
  compaction?: { auto: boolean };
}

/**
 * Build the config patch for the AI Engine settings, or `null` when nothing
 * can be applied (no agent selected, no providers connected, and no known
 * context window for the selected model).
 *
 * - `temperature` → `agent.<agent>.temperature` for the agent in use.
 * - `maxTokens` → `provider.<id>.models.<id>.limit.output` for the selected
 *   model, preserving the model's known context window. A positive value is
 *   clamped to the model's own limit so requests never exceed what the model
 *   allows. `0` (the default) removes any limit written by an earlier update
 *   instead of leaving it behind: a stale `limit.output` caps the whole
 *   reply, reasoning included, so long replies get cut off mid-thought with
 *   nothing but a truncated message behind. Removal clears every model
 *   override of the provider because the server only unsets one model at a
 *   time through its own `limit.output`, and reading the model's real limit
 *   back is no help — `provider.list` already reports the capped value.
 * - `autoCompaction` → `compaction.auto`, which lets the engine summarize
 *   older messages when the context window fills up.
 * - `customApiEndpoint` → `provider.<id>.options.baseURL` for every connected
 *   provider; an empty raw value or `null` removes a previously written
 *   override.
 */
export function buildEngineConfigPatch(
  input: EngineSettingsInput,
  providers: readonly EngineProviderInfo[],
  connectedProviders: readonly string[],
): Config | null {
  const patch: EngineConfigPatch = {};

  const endpoint = input.customApiEndpoint?.trim() ? input.customApiEndpoint.trim() : null;

  if (input.agent) {
    patch.agent = { [input.agent]: { temperature: input.temperature } };
  }

  if (input.autoCompaction !== undefined) {
    patch.compaction = { auto: input.autoCompaction };
  }

  // `models: null` clears the model overrides of every connected provider, so
  // no cap set earlier can outlive the setting that asked for it.
  if (connectedProviders.length > 0) {
    const provider: Record<string, EngineProviderPatch> = {};
    for (const id of connectedProviders) {
      provider[id] = { options: { baseURL: endpoint } };
    }
    if (input.maxTokens <= 0) {
      for (const target of Object.values(provider)) target.models = null;
    }
    patch.provider = provider;
  }

  if (input.modelKey && input.maxTokens > 0) {
    const [providerID, modelID] = splitModelKey(input.modelKey);
    const model =
      providerID && modelID
        ? providers.find((candidate) => candidate.id === providerID)?.models[modelID]
        : undefined;
    const context = model?.limit?.context;
    if (providerID && modelID && context) {
      const nativeOutput = model.limit?.output;
      const capped =
        nativeOutput !== undefined ? Math.min(input.maxTokens, nativeOutput) : input.maxTokens;
      patch.provider ??= {};
      patch.provider[providerID] = {
        ...patch.provider[providerID],
        models: {
          [modelID]: { name: model.name ?? modelID, limit: { context, output: capped } },
        },
      };
    }
  }

  if (!patch.agent && !patch.provider && !patch.compaction) return null;
  return patch as Config;
}

/**
 * Apply the AI Engine settings to the running OpenCode server. Failures are
 * the caller's to surface; nothing is thrown when the client has no global
 * config API (tests and older server builds).
 */
export async function applyEngineSettings(
  client: OpencodeClient,
  input: EngineSettingsInput,
  providers: readonly EngineProviderInfo[],
  connectedProviders: readonly string[],
): Promise<void> {
  const patch = buildEngineConfigPatch(input, providers, connectedProviders);
  if (!patch) return;
  const configApi = client.global?.config;
  if (!configApi) return;
  await configApi.update({ config: patch }, { throwOnError: true });
}
