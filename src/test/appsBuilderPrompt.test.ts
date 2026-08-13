import { describe, expect, it } from "vitest";
import { generateAppFromPrompt, promptToAppName } from "@/lib/appsBuilder/generator";

describe("generateAppFromPrompt", () => {
  it("builds a todo list skeleton from plain English", () => {
    const canvas = generateAppFromPrompt("Create a todo list app");
    const kinds = canvas.map((component) => component.kind);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("input");
    expect(kinds).toContain("list");
    expect(kinds).toContain("button");
    expect(canvas.every((component) => component.id.startsWith("app-"))).toBe(true);
  });

  it("recognizes login and pricing prompts", () => {
    const login = generateAppFromPrompt("Add a login page");
    expect(login.map((component) => component.kind)).toContain("input");
    expect(login.filter((component) => component.kind === "button")[0]?.props.text).toBe("Sign In");

    const pricing = generateAppFromPrompt("I want a pricing page");
    expect(pricing.filter((component) => component.kind === "card").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("falls back to a generic landing page for ambiguous prompts", () => {
    const canvas = generateAppFromPrompt("make something cool");
    expect(canvas.map((component) => component.kind)).toContain("heading");
    expect(canvas.map((component) => component.kind)).toContain("button");
  });

  it("uses the quoted prompt as text when nothing matches", () => {
    const canvas = generateAppFromPrompt("track my plant watering schedule");
    const text = canvas.find((component) => component.kind === "text");
    expect(text?.props.text).toContain("plant watering");
  });

  it("seeds every component with the definition defaults", () => {
    const canvas = generateAppFromPrompt("a blog");
    const heading = canvas.find((component) => component.kind === "heading");
    expect(heading?.props.size).toBe("24px");
    expect(heading?.props.weight).toBe("700");
  });
});

describe("promptToAppName", () => {
  it("returns a human-friendly name per pattern", () => {
    expect(promptToAppName("build a todo list")).toBe("Todo List App");
    expect(promptToAppName("I need a login screen")).toBe("Sign In");
    expect(promptToAppName("weird thing")).toBe("My App");
  });
});
