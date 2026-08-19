import { beforeEach, describe, expect, it, vi } from "vitest";

describe("browser desktop fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    delete window.BloxMind;
  });

  it("surfaces a useful error instead of waiting forever", async () => {
    const { desktop } = await import("@/lib/desktop");

    await expect(desktop.getOpenCodeInfo()).rejects.toThrow(
      "The desktop service is unavailable. Start BloxMind with pnpm dev.",
    );
  });

  it("persists preferences while running as a web preview", async () => {
    const { desktop } = await import("@/lib/desktop");

    await desktop.patchConfig({ lastModel: "openai/gpt-5" });

    await expect(desktop.loadConfig()).resolves.toEqual({
      lastModel: "openai/gpt-5",
      hiddenModels: [],
      theme: "system",
      detailedAnalytics: "unset",
      defaultVariant: null,
      studioTargetPrograms: null,
      studioTargetsBySession: {},
      accentColor: "emerald",
      layoutDensity: "comfortable",
      fontSize: 1,
      fontStyle: "quiet",
      soundEffects: true,
      themePreset: "dark-neon",
      themeColors: {
        selectedBg: "#39FF14",
        selectedFg: "#000000",
        hoverBg: "#E0E0E0",
        hoverFg: "#000000",
      },
      sidebarCollapsed: false,
      explorerCollapsed: false,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "",
      customApiEndpoint: null,
      autoScroll: true,
      enterToSend: true,
      notificationsEnabled: true,
      activeMode: "roblox",
      sseReconnectDelay: 3000,
      sseHeartbeatTimeout: 30000,
      appsSettings: {
        autoPreview: true,
        autoRun: false,
        defaultViewport: "desktop",
        showFileTree: true,
        showLineNumbers: true,
      },
      agentSettings: {
        autoRunOnCreate: false,
        showWorkflowCanvas: true,
        showAgentSidebar: true,
        enableLogging: true,
        autoSaveDrafts: true,
      },
      gamesSettings: {
        autoPreview: true,
        autoRun: false,
        showControlsHint: true,
        showFileTree: true,
        showLineNumbers: true,
      },
    });
  });

  it("rejects malformed persisted values through the config schema", async () => {
    window.localStorage.setItem(
      "BloxMind-config",
      JSON.stringify({ lastModel: 42, hiddenModels: "not-an-array" }),
    );
    const { desktop } = await import("@/lib/desktop");

    await expect(desktop.loadConfig()).resolves.toEqual({
      lastModel: null,
      hiddenModels: [],
      theme: "system",
      detailedAnalytics: "unset",
      defaultVariant: null,
      studioTargetPrograms: null,
      studioTargetsBySession: {},
      accentColor: "emerald",
      layoutDensity: "comfortable",
      fontSize: 1,
      fontStyle: "quiet",
      soundEffects: true,
      themePreset: "dark-neon",
      themeColors: {
        selectedBg: "#39FF14",
        selectedFg: "#000000",
        hoverBg: "#E0E0E0",
        hoverFg: "#000000",
      },
      sidebarCollapsed: false,
      explorerCollapsed: false,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "",
      customApiEndpoint: null,
      autoScroll: true,
      enterToSend: true,
      notificationsEnabled: true,
      activeMode: "roblox",
      sseReconnectDelay: 3000,
      sseHeartbeatTimeout: 30000,
      appsSettings: {
        autoPreview: true,
        autoRun: false,
        defaultViewport: "desktop",
        showFileTree: true,
        showLineNumbers: true,
      },
      agentSettings: {
        autoRunOnCreate: false,
        showWorkflowCanvas: true,
        showAgentSidebar: true,
        enableLogging: true,
        autoSaveDrafts: true,
      },
      gamesSettings: {
        autoPreview: true,
        autoRun: false,
        showControlsHint: true,
        showFileTree: true,
        showLineNumbers: true,
      },
    });
  });

  it("persists the appearance theme preference", async () => {
    const { desktop } = await import("@/lib/desktop");

    await desktop.patchConfig({ theme: "dark" });

    await expect(desktop.loadConfig()).resolves.toEqual({
      lastModel: null,
      hiddenModels: [],
      theme: "dark",
      detailedAnalytics: "unset",
      defaultVariant: null,
      studioTargetPrograms: null,
      studioTargetsBySession: {},
      accentColor: "emerald",
      layoutDensity: "comfortable",
      fontSize: 1,
      fontStyle: "quiet",
      soundEffects: true,
      themePreset: "dark-neon",
      themeColors: {
        selectedBg: "#39FF14",
        selectedFg: "#000000",
        hoverBg: "#E0E0E0",
        hoverFg: "#000000",
      },
      sidebarCollapsed: false,
      explorerCollapsed: false,
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "",
      customApiEndpoint: null,
      autoScroll: true,
      enterToSend: true,
      notificationsEnabled: true,
      activeMode: "roblox",
      sseReconnectDelay: 3000,
      sseHeartbeatTimeout: 30000,
      appsSettings: {
        autoPreview: true,
        autoRun: false,
        defaultViewport: "desktop",
        showFileTree: true,
        showLineNumbers: true,
      },
      agentSettings: {
        autoRunOnCreate: false,
        showWorkflowCanvas: true,
        showAgentSidebar: true,
        enableLogging: true,
        autoSaveDrafts: true,
      },
      gamesSettings: {
        autoPreview: true,
        autoRun: false,
        showControlsHint: true,
        showFileTree: true,
        showLineNumbers: true,
      },
    });
  });

  it("persists detailed analytics consent separately from basic analytics", async () => {
    const { desktop } = await import("@/lib/desktop");

    await desktop.patchConfig({ detailedAnalytics: "enabled" });

    await expect(desktop.loadConfig()).resolves.toMatchObject({ detailedAnalytics: "enabled" });
  });
});
