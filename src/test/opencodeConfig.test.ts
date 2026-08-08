import { describe, expect, it } from "vitest";

import { createOpenCodeConfig } from "../../electron/opencodeConfig";

const broker = { url: "http://127.0.0.1:43210/mcp" };

describe("OpenCode configuration", () => {
  it("does not install third-party authentication plugins by default", () => {
    expect(createOpenCodeConfig(broker)).not.toHaveProperty("plugin");
  });

  it("keeps automatic context compaction enabled", () => {
    expect(createOpenCodeConfig(broker).compaction).toEqual({ auto: true });
  });

  it("keeps Studio instructions concise and action-oriented", () => {
    const prompt = createOpenCodeConfig(broker).agent.studio.prompt;

    // The prompt carries the Rojo live-sync requirements (which are part of the
    // durable Agent Runtime contract) plus the animation and map skill pointers,
    // so keep it tight but allow for them.
    expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(175);
    expect(prompt).toMatch(/inspect only when needed/i);
    expect(prompt).toContain("smallest coherent change");
    expect(prompt).toContain("most relevant Studio check");
    expect(prompt).toContain("Rojo");
    expect(prompt).toContain("stop");
    expect(prompt).toContain("generate_mesh");
    expect(prompt).toMatch(/timeout/i);
    expect(prompt).toContain("roblox-animation");
    expect(prompt).toContain("roblox-map-planning");
    expect(prompt).toMatch(/structured plan before building/i);
    expect(prompt).toMatch(/batch related edits into one pass/i);
  });

  it("focuses sampling for more consistent Studio output", () => {
    expect(createOpenCodeConfig(broker).agent.studio.top_p).toBe(0.95);
  });

  it("allows the agent to load the managed skill pack without prompting", () => {
    expect(createOpenCodeConfig(broker).permission).toEqual({ skill: { "*": "allow" } });
  });

  it("connects OpenCode to the loopback broker with a long tool timeout", () => {
    expect(createOpenCodeConfig(broker).mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      enabled: true,
      timeout: 600_000,
    });
  });
});
