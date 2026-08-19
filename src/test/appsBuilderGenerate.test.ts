import { describe, expect, it } from "vitest";
import {
  looksLikeGameRequest,
  parseAppProject,
  repairAppJson,
  resolveAppProject,
} from "@/lib/appsBuilder/generate";

const VALID_FILES = [
  { path: "package.json", content: '{ "name": "task-flow" }' },
  { path: "src/App.tsx", content: "export default function App() { return null; }" },
];

const VALID_OBJECT = {
  name: "Task Flow",
  description: "A todo list app",
  target: "mobile",
  theme: "dark",
  entry: "src/main.tsx",
  files: VALID_FILES,
};

describe("parseAppProject", () => {
  it("accepts a well-formed project object", () => {
    const project = parseAppProject(VALID_OBJECT);
    expect(project.name).toBe("Task Flow");
    expect(project.files).toHaveLength(2);
  });

  it("throws a helpful error for non-object values", () => {
    expect(() => parseAppProject(null)).toThrow("The generator returned an invalid app project");
    expect(() => parseAppProject([])).toThrow("The generator returned an invalid app project");
    expect(() => parseAppProject("nope")).toThrow("The generator returned an invalid app project");
  });
});

describe("resolveAppProject", () => {
  it("prefers structured output when present", () => {
    const project = resolveAppProject({ structured: VALID_OBJECT }, [
      { type: "text", text: "unrelated prose" },
    ]);
    expect(project.name).toBe("Task Flow");
  });

  it("falls back to parsing the text parts when structured output is missing", () => {
    const project = resolveAppProject({}, [{ type: "text", text: JSON.stringify(VALID_OBJECT) }]);
    expect(project.name).toBe("Task Flow");
    expect(project.files).toHaveLength(2);
  });

  it("unwraps <structured_output> tags that leak into the text", () => {
    const project = resolveAppProject(undefined, [
      {
        type: "text",
        text: `<structured_output>\n${JSON.stringify(VALID_OBJECT)}\n</structured_output>`,
      },
    ]);
    expect(project.name).toBe("Task Flow");
  });

  it("strips JSON code fences from the text", () => {
    const project = resolveAppProject(undefined, [
      {
        type: "text",
        text: `Here is the app:\n\`\`\`json\n${JSON.stringify(VALID_OBJECT)}\n\`\`\``,
      },
    ]);
    expect(project.name).toBe("Task Flow");
  });

  it("throws a StructuredOutputError hint when nothing usable came back", () => {
    expect(() =>
      resolveAppProject(
        { error: { name: "StructuredOutputError", data: { message: "bad json" } } },
        [],
      ),
    ).toThrow(/couldn't produce structured output.*bad json/);
  });

  it("throws for empty responses", () => {
    expect(() => resolveAppProject(undefined, [])).toThrow(
      "The generator returned an empty response",
    );
  });

  it("throws when text is present but not a valid project", () => {
    expect(() =>
      resolveAppProject(undefined, [{ type: "text", text: "I built a todo app for you." }]),
    ).toThrow("The generator returned an invalid app project");
  });

  it("falls back to the text parts when structured output is present but invalid", () => {
    const project = resolveAppProject({ structured: { nope: true } }, [
      { type: "text", text: JSON.stringify(VALID_OBJECT) },
    ]);
    expect(project.name).toBe("Task Flow");
  });

  it("parses a project truncated mid-JSON from the text", () => {
    const truncated = JSON.stringify(VALID_OBJECT).replace(/\}\]$/, "");
    const project = resolveAppProject(undefined, [{ type: "text", text: truncated }]);
    expect(project.name).toBe("Task Flow");
    expect(project.files).toHaveLength(2);
  });
});

describe("looksLikeGameRequest", () => {
  it("routes clear game requests to the 3D stack", () => {
    expect(looksLikeGameRequest("Build me a 3D racing game with physics")).toBe(true);
    expect(looksLikeGameRequest("Create a platformer where you jump across gaps")).toBe(true);
    expect(looksLikeGameRequest("Make an FPS with a first-person camera")).toBe(true);
    expect(looksLikeGameRequest("A puzzle game using react three fiber")).toBe(true);
  });

  it("keeps plain web apps on the web stack", () => {
    expect(looksLikeGameRequest("A to-do list app")).toBe(false);
    expect(looksLikeGameRequest("A website about game reviews")).toBe(false);
    expect(looksLikeGameRequest("A dashboard for tracking sales")).toBe(false);
  });
});

describe("repairAppJson", () => {
  it("closes structures truncated before the closing braces", () => {
    const input = `{"name":"Task Flow","target":"mobile","theme":"dark","files":[{"path":"src/App.tsx","content":"export default"`;
    const repaired = repairAppJson(input);
    expect(repaired).not.toBeNull();
    if (!repaired) return;
    expect(JSON.parse(repaired)).toMatchObject({
      name: "Task Flow",
      files: [{ path: "src/App.tsx", content: "export default" }],
    });
  });

  it("strips trailing commas before closing brackets", () => {
    const input = `{"name":"Task Flow","target":"mobile","theme":"dark","files":[{"path":"a.ts","content":"x",},]}`;
    const repaired = repairAppJson(input);
    expect(repaired).not.toBeNull();
    if (!repaired) return;
    expect(JSON.parse(repaired)).toMatchObject({ name: "Task Flow" });
  });

  it("escapes raw newlines inside string values", () => {
    const input = `{"name":"Task Flow","target":"mobile","theme":"dark","files":[{"path":"src/App.tsx","content":"export default function App() {\n  return null;\n}"}]}`;
    const repaired = repairAppJson(input);
    expect(repaired).not.toBeNull();
    if (!repaired) return;
    expect(JSON.parse(repaired)).toMatchObject({
      files: [{ content: "export default function App() {\n  return null;\n}" }],
    });
  });

  it("returns null when there is no JSON object", () => {
    expect(repairAppJson("I built a todo app for you.")).toBeNull();
  });
});
