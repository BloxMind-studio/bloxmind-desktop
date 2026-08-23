import { describe, expect, it } from "vitest";
import {
  formatMapPrompt,
  MAP_MODES,
  parseEnhancedMapBrief,
  resolveEnhancedMapBrief,
  resolveEnhancedMapFields,
} from "@/lib/mapRequest";

describe("formatMapPrompt", () => {
  it("asks for the plan before building", () => {
    const prompt = formatMapPrompt({
      brief: "A neon arena with a tower in the middle",
      mode: "arena",
      playerCount: "8 players",
      traversalTime: "2 minutes",
      themePillars: ["neon dusk", "glass water"],
      landmarks: ["central tower", "spawn vista"],
      zones: ["spawn", "main loop", "high ground"],
      notes: "Keep the route readable",
    });

    expect(prompt).toContain("roblox-map-planning");
    expect(prompt).toContain("roblox-map-building");
    expect(prompt).toContain("present the written build plan before any building starts");
    expect(prompt).toContain("Theme pillars: neon dusk, glass water");
    expect(prompt).toContain("Zones: spawn, main loop, high ground");
  });

  it("exposes every map mode with a non-empty hint", () => {
    for (const option of MAP_MODES) {
      expect(option.label.trim()).toBeTruthy();
      expect(option.hint.trim()).toBeTruthy();
    }
  });
});

describe("parseEnhancedMapBrief", () => {
  it("returns the trimmed description", () => {
    expect(parseEnhancedMapBrief({ description: "  a neon arena  " })).toBe("a neon arena");
  });

  it("rejects malformed enhancer output", () => {
    expect(() => parseEnhancedMapBrief(null)).toThrow(/invalid/i);
    expect(() => parseEnhancedMapBrief(["description"])).toThrow(/invalid/i);
    expect(() => parseEnhancedMapBrief({ description: "   " })).toThrow(/empty/i);
  });

  it("accepts renamed keys when the schema key is missing", () => {
    expect(parseEnhancedMapBrief({ prompt: "a flooded temple district" })).toBe(
      "a flooded temple district",
    );
  });
});

describe("resolveEnhancedMapBrief", () => {
  const textPart = (text: string) => ({ type: "text", text });

  it("prefers structured output when present", () => {
    expect(resolveEnhancedMapBrief({ structured: { description: "from structured" } }, [])).toBe(
      "from structured",
    );
  });

  it("parses JSON from text parts when structured output is missing", () => {
    expect(resolveEnhancedMapBrief({}, [textPart('{"description": "from json text"}')])).toBe(
      "from json text",
    );
  });

  it("falls back to plain prose when the model ignored the schema", () => {
    expect(resolveEnhancedMapBrief(undefined, [textPart("A dusk-lit neon arena.")])).toBe(
      "A dusk-lit neon arena.",
    );
  });

  it("throws on a completely empty response", () => {
    expect(() => resolveEnhancedMapBrief(undefined, undefined)).toThrow(/empty/i);
  });
});

describe("resolveEnhancedMapFields", () => {
  const textPart = (text: string) => ({ type: "text", text });

  it("resolves a structured multi-field payload into every map field", () => {
    const out = resolveEnhancedMapFields(
      {
        structured: {
          brief: "a neon arena",
          playerCount: "8 players",
          traversalTime: "2 min",
          themePillars: "neon, water",
          landmarks: "tower",
          zones: "spawn, loop",
          notes: "readable",
        },
      },
      undefined,
    );
    expect(out).toEqual({
      brief: "a neon arena",
      playerCount: "8 players",
      traversalTime: "2 min",
      themePillars: "neon, water",
      landmarks: "tower",
      zones: "spawn, loop",
      notes: "readable",
    });
  });

  it("parses a multi-field JSON payload from text parts", () => {
    const out = resolveEnhancedMapFields(undefined, [
      textPart(JSON.stringify({ brief: "arena", notes: "fair 4v4" })),
    ]);
    expect(out.brief).toBe("arena");
    expect(out.notes).toBe("fair 4v4");
  });

  it("falls back to a single brief in plain prose", () => {
    const out = resolveEnhancedMapFields(undefined, [textPart("A dusk-lit neon arena.")]);
    expect(out).toEqual({ brief: "A dusk-lit neon arena." });
  });

  it("throws on a completely empty response", () => {
    expect(() => resolveEnhancedMapFields(undefined, undefined)).toThrow(/empty/i);
  });
});
