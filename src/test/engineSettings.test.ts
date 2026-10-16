import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";
import {
  applyEngineSettings,
  buildEngineConfigPatch,
  type EngineProviderInfo,
  type EngineSettingsInput,
} from "@/lib/engineSettings";

const providers: EngineProviderInfo[] = [
  {
    id: "anthropic",
    models: {
      "claude-3.5-sonnet": { name: "Claude 3.5 Sonnet", limit: { context: 200_000 } },
      "no-limit": { name: "No Limit" },
    },
  },
];

function input(overrides: Partial<EngineSettingsInput> = {}): EngineSettingsInput {
  return {
    temperature: 0.7,
    maxTokens: 4_096,
    customApiEndpoint: null,
    agent: null,
    modelKey: null,
    ...overrides,
  };
}

describe("buildEngineConfigPatch", () => {
  it("sets the temperature on the selected agent", () => {
    const patch = buildEngineConfigPatch(
      input({ agent: "build", temperature: 0.3 }),
      providers,
      [],
    );
    expect(patch).toEqual({ agent: { build: { temperature: 0.3 } } });
  });

  it("returns null when nothing can be applied", () => {
    expect(buildEngineConfigPatch(input(), providers, [])).toBeNull();
  });

  it("writes the endpoint override for every connected provider", () => {
    const patch = buildEngineConfigPatch(
      input({ customApiEndpoint: "https://example.test/api" }),
      providers,
      ["anthropic", "openai"],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: { options: { baseURL: "https://example.test/api" } },
        openai: { options: { baseURL: "https://example.test/api" } },
      },
    });
  });

  it("removes the endpoint override with null when the setting is cleared", () => {
    const patch = buildEngineConfigPatch(input(), providers, ["anthropic"]);
    expect(patch).toEqual({ provider: { anthropic: { options: { baseURL: null } } } });
  });

  it("writes the model's output limit with its known context window", () => {
    const patch = buildEngineConfigPatch(
      input({ modelKey: "anthropic/claude-3.5-sonnet" }),
      providers,
      [],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: {
          models: {
            "claude-3.5-sonnet": {
              name: "Claude 3.5 Sonnet",
              limit: { context: 200_000, output: 4_096 },
            },
          },
        },
      },
    });
  });

  it("skips the model limit when the context window is unknown", () => {
    expect(
      buildEngineConfigPatch(input({ modelKey: "anthropic/no-limit" }), providers, []),
    ).toBeNull();
    expect(buildEngineConfigPatch(input({ modelKey: "missing/model" }), providers, [])).toBeNull();
  });

  it("keeps the endpoint override when the same provider also gets a model limit", () => {
    const patch = buildEngineConfigPatch(
      input({
        modelKey: "anthropic/claude-3.5-sonnet",
        customApiEndpoint: "https://example.test",
      }),
      providers,
      ["anthropic"],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: {
          options: { baseURL: "https://example.test" },
          models: {
            "claude-3.5-sonnet": {
              name: "Claude 3.5 Sonnet",
              limit: { context: 200_000, output: 4_096 },
            },
          },
        },
      },
    });
  });

  it("falls back to the model id when the provider list has no name", () => {
    const unnamed: EngineProviderInfo[] = [
      { id: "local", models: { llama: { limit: { context: 8_192 } } } },
    ];
    const patch = buildEngineConfigPatch(input({ modelKey: "local/llama" }), unnamed, []);
    expect(patch).toEqual({
      provider: {
        local: { models: { llama: { name: "llama", limit: { context: 8_192, output: 4_096 } } } },
      },
    });
  });
});

describe("applyEngineSettings", () => {
  function clientWithGlobal() {
    const update = vi.fn().mockResolvedValue({});
    const client = { global: { config: { update } } } as unknown as OpencodeClient;
    return { update, client };
  }

  it("pushes the patch through the global config API", async () => {
    const { update, client } = clientWithGlobal();
    await applyEngineSettings(client, input({ agent: "build" }), providers, []);
    expect(update).toHaveBeenCalledWith(
      { config: { agent: { build: { temperature: 0.7 } } } },
      { throwOnError: true },
    );
  });

  it("does nothing without a patch or a global config API", async () => {
    const { update, client } = clientWithGlobal();
    await applyEngineSettings(client, input(), providers, []);
    await applyEngineSettings({} as OpencodeClient, input({ agent: "build" }), providers, []);
    expect(update).not.toHaveBeenCalled();
  });
});
