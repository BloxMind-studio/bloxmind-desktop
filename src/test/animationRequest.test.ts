import { describe, expect, it } from "vitest";
import {
  ANIMATION_KINDS,
  formatAnimationPrompt,
  parseEnhancedAnimationBrief,
  resolveEnhancedAnimationBrief,
  resolveEnhancedAnimationFields,
} from "@/lib/animationRequest";

describe("formatAnimationPrompt", () => {
  it("includes rig, loop, and verification instructions", () => {
    const prompt = formatAnimationPrompt({
      brief: "A heavy sword slash with recovery",
      kind: "combat combo",
      rig: "both",
      duration: "1.5s",
      loop: false,
      beats: ["wind-up", "impact", "recover"],
      notes: "No root motion",
    });

    expect(prompt).toContain("roblox-animation");
    expect(prompt).toContain("roblox-animation-runtime");
    expect(prompt).toContain("Rig target: Both");
    expect(prompt).toContain("Loop: no");
    expect(prompt).toContain("Key beats: wind-up | impact | recover");
    expect(prompt).toContain("Verify playback in Studio");
  });

  it("exposes every animation kind with a non-empty hint", () => {
    for (const option of ANIMATION_KINDS) {
      expect(option.label.trim()).toBeTruthy();
      expect(option.hint.trim()).toBeTruthy();
    }
  });
});

describe("parseEnhancedAnimationBrief", () => {
  it("returns the trimmed description", () => {
    expect(parseEnhancedAnimationBrief({ description: "  a heavy slash  " })).toBe("a heavy slash");
  });

  it("rejects malformed enhancer output", () => {
    expect(() => parseEnhancedAnimationBrief(null)).toThrow(/invalid/i);
    expect(() => parseEnhancedAnimationBrief({ description: "" })).toThrow(/empty/i);
  });

  it("accepts renamed keys when the schema key is missing", () => {
    expect(parseEnhancedAnimationBrief({ prompt: "a snappy uppercut combo" })).toBe(
      "a snappy uppercut combo",
    );
  });
});

describe("resolveEnhancedAnimationBrief", () => {
  const textPart = (text: string) => ({ type: "text", text });

  it("prefers structured output when present", () => {
    expect(
      resolveEnhancedAnimationBrief({ structured: { description: "from structured" } }, []),
    ).toBe("from structured");
  });

  it("unwraps structured-output tags around JSON", () => {
    const wrapped = [
      "<structured_output>",
      '{"prompt": "A three-hit dagger combo ending in a spin."}',
      "</structured_output>",
    ].join("\n");
    expect(resolveEnhancedAnimationBrief(undefined, [textPart(wrapped)])).toBe(
      "A three-hit dagger combo ending in a spin.",
    );
  });

  it("falls back to plain prose when the model ignored the schema", () => {
    expect(resolveEnhancedAnimationBrief(undefined, [textPart("A looping victory dance.")])).toBe(
      "A looping victory dance.",
    );
  });

  it("throws on a completely empty response", () => {
    expect(() => resolveEnhancedAnimationBrief(undefined, undefined)).toThrow(/empty/i);
  });
});

describe("resolveEnhancedAnimationFields", () => {
  const textPart = (text: string) => ({ type: "text", text });

  it("resolves a structured multi-field payload into every animation field", () => {
    const out = resolveEnhancedAnimationFields(
      {
        structured: {
          brief: "a heavy sword slash",
          duration: "1.5s",
          beats: "wind-up, impact, recover",
          notes: "no root motion",
        },
      },
      undefined,
    );
    expect(out).toEqual({
      brief: "a heavy sword slash",
      duration: "1.5s",
      beats: "wind-up, impact, recover",
      notes: "no root motion",
    });
  });

  it("parses a multi-field JSON payload from text parts", () => {
    const out = resolveEnhancedAnimationFields(undefined, [
      textPart(JSON.stringify({ brief: "punch", beats: "wind-up, strike" })),
    ]);
    expect(out.brief).toBe("punch");
    expect(out.beats).toBe("wind-up, strike");
  });

  it("fills multiple fields from a keyed-line prose answer", () => {
    const out = resolveEnhancedAnimationFields(undefined, [
      textPart(
        ["duration: 1.5s", "key beats: wind-up, impact, recover", "notes: no root motion"].join(
          "\n",
        ),
      ),
    ]);
    expect(out.duration).toBe("1.5s");
    expect(out.beats).toBe("wind-up, impact, recover");
    expect(out.notes).toBe("no root motion");
  });

  it("falls back to a single brief in plain prose", () => {
    const out = resolveEnhancedAnimationFields(undefined, [textPart("A looping victory dance.")]);
    expect(out).toEqual({ brief: "A looping victory dance." });
  });

  it("throws on a completely empty response", () => {
    expect(() => resolveEnhancedAnimationFields(undefined, undefined)).toThrow(/empty/i);
  });
});
