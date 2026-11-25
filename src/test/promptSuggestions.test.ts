import { describe, expect, it } from "vitest";
import { needsStudio, parseSlashCommand } from "@/lib/promptSuggestions";

describe("slash commands", () => {
  it("splits a command name from its argument", () => {
    expect(parseSlashCommand("/model")).toEqual({ name: "model", input: "" });
    expect(parseSlashCommand("  /undo with argument  ")).toEqual({
      name: "undo",
      input: "with argument",
    });
    expect(parseSlashCommand("not a command")).toBeNull();
  });

  it("only holds messages that would set the agent to work", () => {
    expect(needsStudio("Build a baseplate")).toBe(true);
    expect(needsStudio("/model")).toBe(false);
    expect(needsStudio("/new")).toBe(false);
    expect(needsStudio("/review")).toBe(true);
    expect(needsStudio("/goal")).toBe(false);
    expect(needsStudio("/goal pause")).toBe(false);
    expect(needsStudio("/goal add a roof")).toBe(true);
  });
});
