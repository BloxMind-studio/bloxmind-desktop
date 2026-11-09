import { describe, expect, it } from "vitest";
import {
  extractStructuredOutput,
  parseJsonFromText,
  StructuredOutputError,
} from "@/lib/structuredOutput";

describe("parseJsonFromText", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonFromText('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses a fenced JSON block", () => {
    const text = 'Here you go:\n```json\n{"b": [1, 2]}\n```\nDone.';
    expect(parseJsonFromText(text)).toEqual({ b: [1, 2] });
  });

  it("finds an object inside prose", () => {
    const text = 'Sure — {"version": 1, "source": "code"} is the plan.';
    expect(parseJsonFromText(text)).toEqual({ version: 1, source: "code" });
  });

  it("handles braces inside strings", () => {
    const text = '{"source": "if (x) { return; }", "v": 1}';
    expect(parseJsonFromText(text)).toEqual({ source: "if (x) { return; }", v: 1 });
  });

  it("returns undefined when there is no JSON", () => {
    expect(parseJsonFromText("no json here")).toBeUndefined();
  });
});

describe("extractStructuredOutput", () => {
  it("reads the assistant text from an OC1-shaped prompt response", () => {
    const response = {
      info: { role: "assistant" },
      parts: [
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: '{"goal": "test", "steps": []}' },
      ],
    };
    expect(extractStructuredOutput(response)).toEqual({ goal: "test", steps: [] });
  });

  it("throws when the reply has no text", () => {
    expect(() => extractStructuredOutput({ info: {}, parts: [] })).toThrow(StructuredOutputError);
  });

  it("throws when the reply text is not JSON", () => {
    const response = { info: {}, parts: [{ type: "text", text: "sorry, cannot help" }] };
    expect(() => extractStructuredOutput(response)).toThrow(StructuredOutputError);
  });
});
