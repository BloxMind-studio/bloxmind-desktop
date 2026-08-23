import type { Page } from "@playwright/test";

/**
 * In-page mocks that let the renderer boot outside Electron.
 *
 * Without the desktop bridge `desktop.getOpenCodeInfo()` rejects and the app
 * is stuck on the startup error screen, so e2e tests inject a minimal
 * `window.BloxMind` stub plus a mocked OpenCode HTTP server. Everything that
 * genuinely needs the desktop app (Rojo, checkpoints, Studio targets, ...)
 * rejects, mirroring the browser fallback in src/lib/desktop.ts — the UI
 * already tolerates those failures.
 */
export const MOCK_OPENCODE_PORT = 34999;
export const MOCK_OPENCODE_BASE = `http://127.0.0.1:${MOCK_OPENCODE_PORT}`;

export async function installAppMocks(page: Page): Promise<void> {
  await page.addInitScript((mockPort: number) => {
    const CONFIG_KEY = "BloxMind-config";
    const DEFAULT_CONFIG = {
      lastModel: null,
      hiddenModels: [],
      theme: "system",
      detailedAnalytics: "unset",
      defaultVariant: null,
      studioTargetPrograms: null,
      studioTargetsBySession: {},
      accentColor: "indigo",
      layoutDensity: "comfortable",
      fontSize: 1,
      soundEffects: true,
      themePreset: "soft-blue",
      themeColors: {
        selectedBg: "#3B82F6",
        selectedFg: "#1D4ED8",
        hoverBg: "#3B82F6",
        hoverFg: "#1D4ED8",
      },
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "",
      customApiEndpoint: null,
      fontStyle: "quiet",
      sidebarCollapsed: false,
      explorerCollapsed: false,
      customApiEndpoint: null,
      autoScroll: true,
      enterToSend: true,
      notificationsEnabled: true,
      sseReconnectDelay: 3000,
      sseHeartbeatTimeout: 30000,
    };

    function loadConfig() {
      try {
        const stored = window.localStorage.getItem(CONFIG_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        return { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === "object" ? parsed : {}) };
      } catch {
        return { ...DEFAULT_CONFIG };
      }
    }

    const core: Record<string, unknown> = {
      getOpenCodeInfo: () =>
        Promise.resolve({
          authorization: "Bearer e2e",
          port: mockPort,
          workspace: "e2e-workspace",
        }),
      onOpenCodeStartupProgress: () => () => {},
      onWindowMaximizedChange: () => () => {},
      getVersion: () => Promise.resolve("0.0.0-e2e"),
      loadConfig: () => Promise.resolve(loadConfig()),
      patchConfig: (patch: Record<string, unknown>) => {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...loadConfig(), ...patch }));
        return Promise.resolve();
      },
      checkForUpdate: () => Promise.resolve(null),
      openUrl: () => Promise.resolve(),
      relaunch: () => {
        window.location.reload();
        return Promise.resolve();
      },
      onRojoLog: () => () => {},
    };

    // Anything not stubbed (Rojo, checkpoints, Studio targets, ...) rejects,
    // matching the plain-browser fallback the app already supports.
    (window as unknown as Record<string, unknown>).BloxMind = new Proxy(core, {
      get(target, prop) {
        if (typeof prop === "string" && prop in target) return target[prop];
        return () => Promise.reject(new Error("Unavailable in the e2e environment"));
      },
    });

    // Serve the SSE endpoint from a stream that never closes so the
    // reconnect loop stays quiet for the whole test.
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(`http://127.0.0.1:${mockPort}/event`)) {
        const stream = new ReadableStream({
          start() {
            // Never enqueue or close; navigation teardown cancels the stream.
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return nativeFetch(input, init);
    };
  }, MOCK_OPENCODE_PORT);

  await page.route(`${MOCK_OPENCODE_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });

    switch (url.pathname) {
      case "/session":
      case "/experimental/session":
      case "/agent":
      case "/command":
      case "/skill":
        await json([]);
        return;
      case "/mcp":
        // Report the Studio MCP as connected so the first-run setup wizard
        // does not replace the home screen.
        await json({ "roblox-studio": { status: "connected" } });
        return;
      case "/provider":
        await json({ all: [], connected: [] });
        return;
      case "/provider/auth":
      case "/session/status":
      case "/config":
        await json({});
        return;
      default:
        await json({});
    }
  });
}
