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
      "claude-3.5-sonnet": {
        name: "Claude 3.5 Sonnet",
        limit: { context: 200_000, output: 64_000 },
      },
      "no-limit": { name: "No Limit" },
    },
  },
];

function input(overrides: Partial<EngineSettingsInput> = {}): EngineSettingsInput {
  return {
    temperature: 0.7,
    maxTokens: 0,
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
      input({ customApiEndpoint: "https://example.test/api", maxTokens: 4_096 }),
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
    expect(patch).toEqual({
      provider: { anthropic: { options: { baseURL: null }, models: null } },
    });
  });

  it("treats a blank endpoint as removal", () => {
    const patch = buildEngineConfigPatch(input({ customApiEndpoint: "   " }), providers, [
      "anthropic",
    ]);
    expect(patch).toEqual({
      provider: { anthropic: { options: { baseURL: null }, models: null } },
    });
  });

  it("writes the requested output limit with the model's known context window", () => {
    const patch = buildEngineConfigPatch(
      input({ modelKey: "anthropic/claude-3.5-sonnet", maxTokens: 4_096 }),
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

  it("clamps the requested output limit to the model's own limit", () => {
    const patch = buildEngineConfigPatch(
      input({ modelKey: "anthropic/claude-3.5-sonnet", maxTokens: 100_000 }),
      providers,
      [],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: {
          models: {
            "claude-3.5-sonnet": {
              name: "Claude 3.5 Sonnet",
              limit: { context: 200_000, output: 64_000 },
            },
          },
        },
      },
    });
  });

  it("clears stale model overrides when no cap is requested", () => {
    const patch = buildEngineConfigPatch(
      input({ modelKey: "anthropic/claude-3.5-sonnet" }),
      providers,
      ["anthropic", "openai"],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: { options: { baseURL: null }, models: null },
        openai: { options: { baseURL: null }, models: null },
      },
    });
  });

  it("keeps a set endpoint while clearing stale model overrides", () => {
    const patch = buildEngineConfigPatch(
      input({ customApiEndpoint: "https://example.test" }),
      providers,
      ["anthropic"],
    );
    expect(patch).toEqual({
      provider: {
        anthropic: { options: { baseURL: "https://example.test" }, models: null },
      },
    });
  });

  it("sends nothing when no cap is requested and no provider is connected", () => {
    expect(
      buildEngineConfigPatch(input({ modelKey: "anthropic/claude-3.5-sonnet" }), providers, []),
    ).toBeNull();
  });

  it("skips the model override when the context window is unknown", () => {
    expect(
      buildEngineConfigPatch(
        input({ modelKey: "anthropic/no-limit", maxTokens: 4_096 }),
        providers,
        [],
      ),
    ).toBeNull();
    expect(
      buildEngineConfigPatch(input({ modelKey: "missing/model", maxTokens: 4_096 }), providers, []),
    ).toBeNull();
  });

  it("keeps the endpoint override when the same provider also gets a model limit", () => {
    const patch = buildEngineConfigPatch(
      input({
        modelKey: "anthropic/claude-3.5-sonnet",
        maxTokens: 4_096,
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

  it("uses the requested cap as-is when the model has no known output limit", () => {
    const unnamed: EngineProviderInfo[] = [
      { id: "local", models: { llama: { limit: { context: 8_192 } } } },
    ];
    const patch = buildEngineConfigPatch(
      input({ modelKey: "local/llama", maxTokens: 4_096 }),
      unnamed,
      [],
    );
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
