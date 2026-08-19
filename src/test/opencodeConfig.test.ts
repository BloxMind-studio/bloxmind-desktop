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
    expect(createOpenCodeConfig(broker).permission.skill).toEqual({ "*": "allow" });
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

  it("keeps the Apps agent scoped to real file tools, forbidding subagents and bash", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    expect(prompt).toMatch(/file tools/i);
    expect(prompt).toMatch(/read, write, edit, glob, grep/i);
    expect(prompt).toMatch(/apps\/ in the workspace/i);
    expect(prompt).toMatch(/bloxmind\.json/i);
    expect(prompt).toMatch(/no bash, Roblox, or Task\/subagent tools/i);
    expect(prompt).toMatch(/never try to use one/i);
    expect(prompt).toContain("app-web-blueprint");
    expect(prompt).toContain("app-canvas-animation");
    expect(prompt).toContain("app-data-api");
  });

  it("demands a production SaaS aesthetic with the preview-safe stack and no broken assets", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    // The live preview only supports react/lucide-react with hand-written plain
    // CSS and inline object styles, so the prompt must say so explicitly and
    // forbid style libraries.
    expect(prompt).toMatch(/plain CSS/i);
    expect(prompt).toMatch(/never Tailwind, Radix, shadcn, zustand/i);
    expect(prompt).toMatch(/inline object styles/i);
    expect(prompt).toMatch(/modern SaaS look/i);
    expect(prompt).toMatch(/subtle borders, soft shadows/i);
    expect(prompt).toMatch(/never external image URLs that might break/i);
    expect(prompt).toMatch(/loading states, hover interactions, smooth transitions/i);
    expect(prompt).toMatch(/mock JSON datasets/i);
    expect(prompt).toMatch(/min-height: 100vh/i);
  });

  it("demands a single self-contained default component root", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    expect(prompt).toMatch(/single, fully valid default React component/i);
    expect(prompt).toMatch(/same file tree/i);
    expect(prompt).toMatch(/nothing may import a module that doesn't exist/i);
  });

  it("prioritizes speed with concise code and no commentary or comments", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    expect(prompt).toMatch(/Performance & speed mandate/i);
    expect(prompt).toMatch(/concise, highly efficient React code/i);
    expect(prompt).toMatch(/Omit conversational introductions, explanations, and code comments/i);
    expect(prompt).toMatch(/no commentary, no summaries, no filler/i);
  });

  it("instructs iterative, context-retaining patching for change requests", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    expect(prompt).toMatch(/Iterative protocol/i);
    expect(prompt).toMatch(/read the current files first/i);
    expect(prompt).toMatch(/keep existing state logic and layout/i);
    expect(prompt).toMatch(/preserve working features, localStorage hooks/i);
    expect(prompt).toMatch(/clean patched build/i);
  });

  it("keeps the Apps agent sandboxed from bash and the Roblox MCP, with websearch", () => {
    const agent = createOpenCodeConfig(broker).agent.apps;
    expect(agent.tools.bash).toBe(false);
    expect(agent.tools.websearch).toBe(true);
    expect(agent.mcp["roblox-studio"]).toBe(false);
  });

  it("adds a full React Three Fiber + Rapier game mode to the Apps agent", () => {
    const prompt = createOpenCodeConfig(broker).agent.apps.prompt;
    expect(prompt).toMatch(/engine": "3d"/);
    expect(prompt).toMatch(/@react-three\/fiber/);
    expect(prompt).toMatch(/@react-three\/drei/);
    expect(prompt).toMatch(/@react-three\/rapier/);
    expect(prompt).toMatch(/three/i);
    expect(prompt).toMatch(/procedural assets only/i);
    expect(prompt).toMatch(/never manual bounding-box math/i);
    expect(prompt).toMatch(/START MENU.*ACTIVE GAMEPLAY.*PAUSE/i);
    expect(prompt).toMatch(/low-poly stylized look/i);
    expect(prompt).toMatch(/WASD\/Arrow keys/i);
    expect(prompt).toMatch(/drei <Html>/i);
  });
});
