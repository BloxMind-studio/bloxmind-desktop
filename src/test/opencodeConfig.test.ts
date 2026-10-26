import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createOpenCodeConfig,
  skillDirectories,
  studioMcpCommand,
} from "../../electron/opencodeConfig";

const broker = { url: "http://127.0.0.1:43210/mcp" };

describe("Studio MCP command", () => {
  it("resolves cmd.exe through ComSpec instead of PATH on Windows", () => {
    expect(
      studioMcpCommand("win32", {
        localAppData: "C:\\Users\\User\\AppData\\Local",
        comSpec: "C:\\WINDOWS\\system32\\cmd.exe",
      }),
    ).toEqual([
      "C:\\WINDOWS\\system32\\cmd.exe",
      "/c",
      "C:\\Users\\User\\AppData\\Local\\Roblox\\mcp.bat",
    ]);
  });

  it("falls back to SystemRoot, then C:\\Windows, when ComSpec is missing", () => {
    expect(studioMcpCommand("win32", { systemRoot: "D:\\Windows" })[0]).toBe(
      "D:\\Windows\\System32\\cmd.exe",
    );
    expect(studioMcpCommand("win32")[0]).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("keeps the direct StudioMCP binary on macOS", () => {
    expect(studioMcpCommand("darwin")).toEqual([
      "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
    ]);
  });
});

describe("OpenCode configuration", () => {
  it("does not install third-party authentication plugins by default", () => {
    expect(createOpenCodeConfig(broker)).not.toHaveProperty("plugin");
  });

  it("keeps automatic context compaction enabled", () => {
    expect(createOpenCodeConfig(broker).compaction).toEqual({ auto: true });
  });

  it("keeps Studio instructions concise and action-oriented", () => {
    const prompt = createOpenCodeConfig(broker).agent.studio.prompt;

    expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(125);
    expect(prompt).toMatch(/inspect before editing/i);
    expect(prompt).toContain("smallest coherent change");
    expect(prompt).toContain("most relevant Studio check");
    expect(prompt).toContain("stop retrying");
    expect(prompt).toContain("pass studio_id");
    expect(prompt).toContain("never call set_active_studio");
    expect(prompt).toContain("stop");
  });

  it("rules out Rojo and filesystem-sync assumptions", () => {
    const prompt = createOpenCodeConfig(broker).agent.studio.prompt;

    expect(prompt).toContain("standalone AI workspace");
    expect(prompt).toContain("Studio MCP bridge");
    expect(prompt).toContain("no Rojo");
    expect(prompt).toContain("no default.project.json");
    expect(prompt).toContain("no local filesystem-to-Studio syncing");
    expect(prompt).toContain("never look for, assume, or mention them");
  });

  it("connects OpenCode to the loopback broker", () => {
    expect(createOpenCodeConfig(broker).mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      enabled: true,
    });
  });

  it("sends the broker's per-launch bearer token with every request", () => {
    const headers = { Authorization: "Bearer test-token" };
    expect(createOpenCodeConfig({ ...broker, headers }).mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      headers,
      enabled: true,
    });
  });

  it("keeps the Studio bridge alone when no extra servers are configured", () => {
    expect(Object.keys(createOpenCodeConfig(broker).mcp)).toEqual(["roblox-studio"]);
  });

  it("writes user-configured MCP servers beside the Studio bridge", () => {
    const config = createOpenCodeConfig(
      broker,
      [],
      [
        {
          name: "blender",
          type: "local",
          command: ["uvx", "mcp-for-blender"],
          url: null,
          enabled: true,
          environment: { DISABLE_TELEMETRY: "1" },
        },
        {
          name: "notes",
          type: "remote",
          command: null,
          url: "https://example.com/mcp",
          enabled: false,
        },
      ],
    );

    expect(config.mcp.blender).toEqual({
      type: "local",
      command: ["uvx", "mcp-for-blender"],
      environment: { DISABLE_TELEMETRY: "1" },
      enabled: true,
    });
    expect(config.mcp.notes).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      enabled: false,
    });
    expect(config.mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      enabled: true,
    });
  });

  it("drops invalid and reserved extra servers instead of failing startup", () => {
    const config = createOpenCodeConfig(
      broker,
      [],
      [
        { name: "roblox-studio", type: "local", command: ["x"], url: null, enabled: true },
        { name: "broken", type: "local", command: [], url: null, enabled: true },
        { name: "bad url", type: "remote", command: null, url: "nope", enabled: true },
      ],
    );

    expect(Object.keys(config.mcp)).toEqual(["roblox-studio"]);
    expect(config.mcp["roblox-studio"]).toEqual({
      type: "remote",
      url: broker.url,
      enabled: true,
    });
  });
});

describe("Bundled skills", () => {
  it("scans the skills copied next to the packaged app's resources", () => {
    expect(
      skillDirectories({
        appPath: join("C:\\", "app", "resources", "app.asar"),
        isPackaged: true,
        resourcesPath: join("C:\\", "app", "resources"),
      }),
    ).toEqual([join("C:\\", "app", "resources", "skills")]);
  });

  it("scans the repository copy during development", () => {
    expect(
      skillDirectories({
        appPath: join("C:\\", "repo"),
        isPackaged: false,
        resourcesPath: join("C:\\", "electron", "resources"),
      }),
    ).toEqual([join("C:\\", "repo", ".agents", "skills")]);
  });

  it("stays out of the config until a skill actually ships", () => {
    expect(createOpenCodeConfig(broker)).not.toHaveProperty("skills");
  });

  it("advertises the shipped skill directory in skills.paths", () => {
    const config = createOpenCodeConfig(broker, ["C:\\app\\resources\\skills"]);

    expect(config.skills).toEqual({ paths: ["C:\\app\\resources\\skills"] });
    expect(config.agent.studio.mode).toBe("primary");
  });
});
