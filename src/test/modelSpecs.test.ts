import { describe, expect, it } from "vitest";
import {
  findModelInfo,
  formatTokens,
  modelSpecs,
  reasoningLabel,
  resolveContextWindow,
} from "@/lib/modelSpecs";
import type { ModelInfo } from "@/types";

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    providerId: "deepseek",
    providerName: "DeepSeek",
    ...overrides,
  };
}

describe("modelSpecs", () => {
  it("reads the provider's own limits, inputs and reasoning", () => {
    const specs = modelSpecs(
      model({
        limit: { context: 200_000, output: 65_536 },
        capabilities: {
          reasoning: true,
          attachment: true,
          input: { text: true, image: true, audio: false, video: false, pdf: false },
        },
      }),
    );

    expect(specs).toEqual({
      model: "DeepSeek V4.1 Flash",
      provider: "DeepSeek",
      inputs: ["text", "image"],
      reasoning: true,
      contextWindow: 200_000,
      outputLimit: 65_536,
    });
  });

  it("falls back to text-only when the provider sends no input flags", () => {
    expect(modelSpecs(model())?.inputs).toEqual(["text"]);
    expect(modelSpecs(model({ capabilities: { attachment: true } }))?.inputs).toEqual([
      "text",
      "image",
    ]);
    expect(modelSpecs(null)).toBeNull();
  });

  it("formats tokens, limits, and reasoning for display", () => {
    expect(formatTokens(200_000)).toBe("200,000");
    expect(formatTokens(0)).toBeUndefined();
    expect(formatTokens(undefined)).toBeUndefined();
    expect(reasoningLabel(true)).toBe("Allows reasoning");
    expect(reasoningLabel(false)).toBe("No reasoning");
    expect(reasoningLabel(undefined)).toBe("Unknown");
  });
});

describe("resolveContextWindow", () => {
  it("prefers the context window the provider reports", () => {
    const models = [model({ limit: { context: 200_000 } })];
    expect(resolveContextWindow("deepseek/deepseek-v4.1-flash", models)).toBe(200_000);
  });

  it("falls back to known models and ids when the provider is silent", () => {
    const models = [model({ id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" })];
    expect(resolveContextWindow("anthropic/claude-3-5-sonnet", models)).toBe(200_000);
    expect(resolveContextWindow("mystery/model-32k", models)).toBe(32_000);
    expect(resolveContextWindow(undefined, models)).toBe(128_000);
  });
});

describe("findModelInfo", () => {
  it("matches provider/model keys and bare ids", () => {
    const models = [model()];
    expect(findModelInfo("deepseek/deepseek-v4.1-flash", models)?.id).toBe("deepseek-v4.1-flash");
    expect(findModelInfo("deepseek-v4.1-flash", models)?.providerId).toBe("deepseek");
    expect(findModelInfo("nope", models)).toBeUndefined();
    expect(findModelInfo(undefined, models)).toBeUndefined();
  });
});
