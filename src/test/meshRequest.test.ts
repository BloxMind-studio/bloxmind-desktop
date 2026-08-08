import { describe, expect, it } from "vitest";
import {
  formatMeshPrompt,
  MESH_STYLES,
  parseEnhancedMeshBrief,
  resolveEnhancedMeshBrief,
} from "@/lib/meshRequest";

describe("formatMeshPrompt", () => {
  it("includes the brief, style, and timeout-safe execution rules", () => {
    const prompt = formatMeshPrompt({
      brief: "a cute green alien with big black eyes",
      style: "blocky",
      maxSize: "2 studs tall",
      segments: [],
    });
    expect(prompt).toContain("a cute green alien with big black eyes");
    expect(prompt).toContain("Blocky");
    expect(prompt).toContain("Approximate size: 2 studs tall");
    expect(prompt).toContain("generate_mesh");
    expect(prompt).toContain("-32001");
    expect(prompt).toMatch(/retry at most twice/i);
  });

  it("lists requested segments when provided and omits empty size", () => {
    const prompt = formatMeshPrompt({
      brief: "alien",
      style: "low-poly",
      maxSize: "",
      segments: ["body", "head"],
    });
    expect(prompt).toContain("body, head");
    expect(prompt).not.toContain("Approximate size");
  });

  it("exposes every mesh style with a non-empty hint", () => {
    for (const option of MESH_STYLES) {
      expect(option.label.trim()).toBeTruthy();
      expect(option.hint.trim()).toBeTruthy();
    }
  });
});

describe("parseEnhancedMeshBrief", () => {
  it("returns the trimmed description", () => {
    expect(parseEnhancedMeshBrief({ description: "  a green alien  " })).toBe("a green alien");
  });

  it("rejects malformed enhancer output", () => {
    expect(() => parseEnhancedMeshBrief(null)).toThrow(/invalid/i);
    expect(() => parseEnhancedMeshBrief(["description"])).toThrow(/invalid/i);
    expect(() => parseEnhancedMeshBrief({ description: "   " })).toThrow(/empty/i);
  });

  it("accepts renamed keys and a lone string property", () => {
    expect(parseEnhancedMeshBrief({ prompt: "a red sports car" })).toBe("a red sports car");
    expect(parseEnhancedMeshBrief({ result: "a red sports car" })).toBe("a red sports car");
    expect(() => parseEnhancedMeshBrief({ a: "x", b: "y" })).toThrow(/empty/i);
  });
});

describe("resolveEnhancedMeshBrief", () => {
  const textPart = (text: string) => ({ type: "text", text });

  it("prefers structured output when present", () => {
    expect(
      resolveEnhancedMeshBrief({ structured: { description: "from structured" } }, [
        textPart("ignored text"),
      ]),
    ).toBe("from structured");
  });

  it("parses JSON from text parts when structured output is missing", () => {
    expect(resolveEnhancedMeshBrief({}, [textPart('{"description": "from json text"}')])).toBe(
      "from json text",
    );
  });

  it("strips a code fence before parsing JSON", () => {
    expect(
      resolveEnhancedMeshBrief(undefined, [textPart('```json\n{"description": "fenced"}\n```')]),
    ).toBe("fenced");
  });

  it("unwraps <structured_output> tags and accepts a renamed prompt key", () => {
    const wrapped = [
      "<structured_output>",
      "{",
      '  "prompt": "A sleek modern sports car with a low-slung aerodynamic silhouette."',
      "}",
      "</structured_output>",
    ].join("\n");
    expect(resolveEnhancedMeshBrief(undefined, [textPart(wrapped)])).toBe(
      "A sleek modern sports car with a low-slung aerodynamic silhouette.",
    );
  });

  it("strips leaked tags even from non-JSON prose answers", () => {
    const wrapped = "<structured_output>A chunky blocky robot.</structured_output>";
    expect(resolveEnhancedMeshBrief(undefined, [textPart(wrapped)])).toBe("A chunky blocky robot.");
  });

  it("falls back to plain prose when the model ignored the schema", () => {
    expect(resolveEnhancedMeshBrief(undefined, [textPart("A glossy green alien.")])).toBe(
      "A glossy green alien.",
    );
  });

  it("surfaces StructuredOutputError details when nothing usable came back", () => {
    expect(() =>
      resolveEnhancedMeshBrief(
        { error: { name: "StructuredOutputError", data: { message: "bad json" } } },
        [],
      ),
    ).toThrow(/bad json/);
  });

  it("throws on a completely empty response", () => {
    expect(() => resolveEnhancedMeshBrief(undefined, undefined)).toThrow(/empty/i);
  });
});
