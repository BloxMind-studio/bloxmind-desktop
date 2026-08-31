import { describe, expect, it } from "vitest";

import { createOpenCodeConfig } from "../../electron/opencodeConfig";

const broker = { url: "http://127.0.0.1:43210/mcp", token: "test-token-123" };

describe("OpenCode configuration", () => {
  it("does not install third-party authentication plugins by default", () => {
    expect(createOpenCodeConfig(broker)).not.toHaveProperty("plugin");
  });

  it("keeps automatic context compaction enabled", () => {
    expect(createOpenCodeConfig(broker).compaction).toEqual({ auto: true });
  });

  it("keeps Studio instructions concise and action-oriented", () => {
    const prompt = createOpenCodeConfig(broker).agent.studio.prompt;

    // The prompt carries the Rojo live-sync requirements (part of the durable
    // Agent Runtime contract), the animation/map skill pointers, AND the verified
    // Roblox API references (Terrain/Sky/Lighting/animation) so the agent stays
    // correct even when project skills are not discoverable by the engine. The
    // references are intentionally detailed; guard against runaway bloat only.
    expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(2200);
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
    expect(prompt).toContain("roblox-knit");
    expect(prompt).toContain("roblox-profile-service");
    expect(prompt).toMatch(/wally\.toml/i);
    expect(prompt).toMatch(/Packages folder/i);
    expect(prompt).toMatch(/batch related edits into one pass/i);
    // The Studio MCP exposes its own assistant skills; the prompt must point
    // the agent at them so both skill families get used.
    expect(prompt).toContain("rbx-docs-search");
    expect(prompt).toContain("rbx-scene-analysis");
    expect(prompt).toContain("rbx-unit-test");
    expect(prompt).toContain("rbx-perf-profiling");
    // The Studio MCP enforces strict Luau execution constraints; the guardrail
    // section must be present and the crashing Lighting.Technology pattern removed.
    expect(prompt).not.toContain("Enum.Technology.Future");
    expect(prompt).toContain("DirectionalLight");
    expect(prompt).toContain("FindFirstChild");
    expect(prompt).toMatch(/CRITICAL.*EXECUTION CONSTRAINTS/i);
    // API guardrails for the 5 most common Luau runtime errors
    expect(prompt).toContain("table.concat");
    expect(prompt).toContain("Enum.PartType.Wedge");
    expect(prompt).toMatch(/NEVER call .*Terrain:Destroy/i);
    expect(prompt).toContain("workspace.Terrain:Clear()");
    expect(prompt).toMatch(/Intensity.*Spread|Spread.*Intensity/);
    expect(prompt).toMatch(/NEVER set .*\.SunRaysSize/);
    expect(prompt).not.toContain("Enum.Material.Wedge");
    expect(prompt).toContain("FindFirstChild");
    expect(prompt).toContain(":GetChildren()");
  });

  it("focuses sampling for more consistent Studio output", () => {
    expect(createOpenCodeConfig(broker).agent.studio.top_p).toBe(0.95);
  });

  it("allows the agent to load the managed skill pack without prompting", () => {
    expect(createOpenCodeConfig(broker).permission.skill).toEqual({ "*": "allow" });
  });

  it("points the skill loader at the app-managed pack deterministically", () => {
    expect(createOpenCodeConfig(broker).skills).toEqual({ paths: [".opencode/skills"] });
  });

  it("registers the Roblox/BloxMind slash commands for the chat / picker", () => {
    const commands = createOpenCodeConfig(broker).command;

    expect(Object.keys(commands).sort()).toEqual(["mcp-setup", "roblox-script", "roblox-ui"]);
    for (const definition of Object.values(commands)) {
      expect(definition.agent).toBe("studio");
      expect(definition.description.length).toBeGreaterThan(0);
      // OpenCode's config schema requires `template` per command (validated at
      // server startup — "Missing key command.<name>.template"); `prompt` is
      // not a recognised field and made the whole config invalid.
      expect(definition.template.length).toBeGreaterThan(0);
      expect(definition).not.toHaveProperty("prompt");
    }
    // /mcp-setup hands the user the Studio MCP connection playbook; the script
    // and UI commands point the agent at the matching Luau architecture rules.
    expect(commands["mcp-setup"].template).toMatch(/mcp-setup/);
    expect(commands["roblox-script"].template).toMatch(/roblox-script/);
    expect(commands["roblox-ui"].template).toMatch(/roblox-ui/);
  });

  it("keeps bash on ask so git or shell commands require in-app approval", () => {
    expect(createOpenCodeConfig(broker).permission.bash).toBe("ask");
    expect(createOpenCodeConfig(broker).agent.studio.tools.bash).toBe(true);
    expect(createOpenCodeConfig(broker).agent.studio.prompt).toMatch(/explicit approval/i);
  });

  it("connects OpenCode to the loopback broker with a long tool timeout", () => {
    expect(createOpenCodeConfig(broker).mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      headers: { Authorization: `Bearer ${broker.token}` },
      enabled: true,
      timeout: 600_000,
    });
  });
});
