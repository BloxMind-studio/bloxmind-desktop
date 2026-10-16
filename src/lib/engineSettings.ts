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
  limit?: { context?: number };
}

/** One provider as surfaced by `provider.list`, reduced to what the patch needs. */
export interface EngineProviderInfo {
  id: string;
  models: Record<string, EngineModelInfo>;
}

/** The Settings → AI Engine values to push into the server config. */
export interface EngineSettingsInput {
  temperature: number;
  maxTokens: number;
  customApiEndpoint: string | null;
  agent: string | null;
  modelKey: string | null;
}

interface EngineProviderPatch {
  options?: { baseURL: string | null };
  models?: Record<string, { name: string; limit: { context: number; output: number } }>;
}

interface EngineConfigPatch {
  agent?: Record<string, { temperature: number }>;
  provider?: Record<string, EngineProviderPatch>;
}

/**
 * Build the config patch for the AI Engine settings, or `null` when nothing
 * can be applied (no agent selected, no providers connected, and no known
 * context window for the selected model).
 *
 * - `temperature` → `agent.<agent>.temperature` for the agent in use.
 * - `maxTokens` → `provider.<id>.models.<id>.limit.output` for the selected
 *   model, preserving the model's known context window.
 * - `customApiEndpoint` → `provider.<id>.options.baseURL` for every connected
 *   provider; `null` removes a previously written override.
 */
export function buildEngineConfigPatch(
  input: EngineSettingsInput,
  providers: readonly EngineProviderInfo[],
  connectedProviders: readonly string[],
): Config | null {
  const patch: EngineConfigPatch = {};

  if (input.agent) {
    patch.agent = { [input.agent]: { temperature: input.temperature } };
  }

  if (connectedProviders.length > 0) {
    const provider: Record<string, EngineProviderPatch> = {};
    for (const id of connectedProviders) {
      provider[id] = { options: { baseURL: input.customApiEndpoint } };
    }
    patch.provider = provider;
  }

  if (input.modelKey) {
    const [providerID, modelID] = splitModelKey(input.modelKey);
    const model =
      providerID && modelID
        ? providers.find((candidate) => candidate.id === providerID)?.models[modelID]
        : undefined;
    const context = model?.limit?.context;
    if (providerID && modelID && context) {
      patch.provider ??= {};
      patch.provider[providerID] = {
        ...patch.provider[providerID],
        models: {
          [modelID]: {
            name: model.name ?? modelID,
            limit: { context, output: input.maxTokens },
          },
        },
      };
    }
  }

  if (!patch.agent && !patch.provider) return null;
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
