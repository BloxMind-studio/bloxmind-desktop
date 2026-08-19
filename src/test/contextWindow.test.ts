import { describe, expect, it } from "vitest";
import {
  lookupKnownModel,
  parseContextWindowFromId,
  resolveContextWindow,
} from "@/lib/contextWindow";

// ── parseContextWindowFromId ───────────────────────────────────────────────

describe("parseContextWindowFromId", () => {
  it("returns undefined for undefined and empty input", () => {
    expect(parseContextWindowFromId(undefined)).toBeUndefined();
    expect(parseContextWindowFromId("")).toBeUndefined();
  });

  it("parses k-suffix values", () => {
    expect(parseContextWindowFromId("128k")).toBe(128_000);
    expect(parseContextWindowFromId("model-200k")).toBe(200_000);
    expect(parseContextWindowFromId("MODEL-128K")).toBe(128_000);
    expect(parseContextWindowFromId(" 64k ")).toBe(64_000);
  });

  it("parses m-suffix values", () => {
    expect(parseContextWindowFromId("1m")).toBe(1_000_000);
    expect(parseContextWindowFromId("model-2m")).toBe(2_000_000);
    // "2.5m" has a word boundary before "5m" so the regex extracts 5m → 5_000_000
    expect(parseContextWindowFromId("2.5m")).toBe(5_000_000);
  });

  it("rejects zero and negative numbers", () => {
    expect(parseContextWindowFromId("0k")).toBeUndefined();
    expect(parseContextWindowFromId("0m")).toBeUndefined();
  });

  it("returns undefined when no k/m suffix is present", () => {
    expect(parseContextWindowFromId("gpt-4")).toBeUndefined();
    expect(parseContextWindowFromId("128kb")).toBeUndefined(); // word boundary prevents this
  });
});

// ── lookupKnownModel ──────────────────────────────────────────────────────

describe("lookupKnownModel", () => {
  it("matches on modelId substring (case-insensitive)", () => {
    expect(lookupKnownModel("gpt-5.4-mini", "GPT-5.4 Mini")).toBe(400_000);
    expect(lookupKnownModel("claude-3-5-sonnet", "Claude 3.5 Sonnet")).toBe(200_000);
  });

  it("matches on modelName substring", () => {
    expect(lookupKnownModel("providers/anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet")).toBe(
      200_000,
    );
  });

  it("falls back to base-id (last path segment)", () => {
    expect(lookupKnownModel("anthropic/claude-3.5-sonnet", "Some Name")).toBe(200_000);
    expect(lookupKnownModel("providers/openai/gpt-5.4", "GPT-5.4")).toBe(400_000);
  });

  it("returns undefined for unknown models", () => {
    expect(lookupKnownModel("unknown-model", "Unknown Model")).toBeUndefined();
  });
});

// ── resolveContextWindow ──────────────────────────────────────────────────

describe("resolveContextWindow", () => {
  const models = [
    { providerId: "anthropic", id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
    { providerId: "openai", id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { providerId: "google", id: "gemini-2.0", name: "Gemini 2.0" },
  ];

  it("returns the default when modelId is undefined", () => {
    expect(resolveContextWindow(undefined, models)).toBe(128_000);
  });

  it("returns the known capacity when a model matches", () => {
    expect(resolveContextWindow("anthropic/claude-3.5-sonnet", models)).toBe(200_000);
    expect(resolveContextWindow("claude-3.5-sonnet", models)).toBe(200_000);
  });

  it("falls back to regex on the raw modelId when no model matches", () => {
    expect(resolveContextWindow("custom-model-256k", models)).toBe(256_000);
  });

  it("returns the default when nothing matches", () => {
    expect(resolveContextWindow("obscure-model", models)).toBe(128_000);
  });

  it("returns the default for an empty model list", () => {
    expect(resolveContextWindow(undefined, [])).toBe(128_000);
  });
});
