import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppsBuilder } from "@/components/AppsBuilder";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BUILD_STATUS_MESSAGES } from "@/lib/appsBuilder/buildProgress";
import type { AppChatMessage, AppProject, SavedApp } from "@/lib/appsBuilder/types";
import { qk } from "@/lib/queryKeys";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

const appProject: AppProject = {
  name: "Task Flow",
  description: "A todo list app",
  target: "mobile",
  theme: "dark",
  engine: "web",
  entry: "src/main.tsx",
  files: [
    { path: "package.json", content: '{ "name": "task-flow" }' },
    { path: "src/main.tsx", content: 'import App from "./App";' },
    { path: "src/App.tsx", content: "export default function App() { return <h1>My Tasks</h1>; }" },
    { path: "src/index.css", content: "body { margin: 0; }" },
  ],
};

const { generateState, developerState } = vi.hoisted(() => ({
  generateState: {
    isPending: false,
    neverResolve: false,
    onProgress: null as null | ((phase: string) => void),
    onSessionReady: null as null | ((sessionID: string) => void),
    onActivity: null as null | ((event: unknown) => void),
    lastPrompt: "",
    lastExisting: null as null | AppProject,
    lastSessionID: null as null | string,
    resolveHooks: null as null | ((value: AppProject | null) => void),
    callCount: 0,
    throwError: null as null | string,
  },
  developerState: {
    pending: false,
    neverResolve: false,
    build: true,
    reply: "On it — let's build that!",
    lastMessage: "",
    lastHistory: [] as AppChatMessage[],
    lastExisting: null as null | AppProject,
    onDeltas: null as null | ((accumulated: string) => void),
    resolveHooks: null as null | ((value: { response: string; build: boolean } | null) => void),
  },
}));

vi.mock("@/hooks/mutations/useGenerateApp", () => ({
  useGenerateApp: (options?: {
    onProgress?: (phase: string) => void;
    onSessionReady?: (sessionID: string) => void;
    onActivity?: (event: unknown) => void;
  }) => {
    generateState.onProgress = options?.onProgress ?? null;
    generateState.onSessionReady = options?.onSessionReady ?? null;
    generateState.onActivity = options?.onActivity ?? null;
    return {
      get isPending() {
        return generateState.isPending;
      },
      abort: vi.fn(() => {
        generateState.isPending = false;
        generateState.resolveHooks?.(null);
      }),
      mutateAsync: generateState.neverResolve
        ? vi.fn(() => {
            generateState.isPending = true;
            return new Promise<AppProject | null>((resolve) => {
              generateState.resolveHooks = resolve;
            });
          })
        : vi.fn(
            async (input: {
              request: string;
              existing?: AppProject | null;
              sessionID?: string | null;
            }) => {
              generateState.lastPrompt = input.request;
              generateState.lastExisting = input.existing ?? null;
              generateState.lastSessionID = input.sessionID ?? null;
              generateState.isPending = true;
              generateState.callCount++;
              // Mirror the real hook: report the resolved session before the
              // run settles so the builder can persist it on save.
              generateState.onSessionReady?.(
                input.sessionID ?? "session-1",
              );
              if (generateState.throwError) {
                const message = generateState.throwError;
                generateState.throwError = null;
                generateState.isPending = false;
                throw new Error(message);
              }
              generateState.isPending = false;
              return appProject;
            },
          ),
    };
  },
}));

vi.mock("@/hooks/mutations/useDeveloperReply", () => ({
  useDeveloperReply: (options?: { onDeltas?: (accumulated: string) => void }) => {
    developerState.onDeltas = options?.onDeltas ?? null;
    return {
      get isPending() {
        return developerState.pending;
      },
      abort: vi.fn(() => {
        developerState.pending = false;
        developerState.resolveHooks?.(null);
      }),
      mutateAsync: developerState.neverResolve
        ? vi.fn(() => {
            developerState.pending = true;
            return new Promise<{ response: string; build: boolean } | null>((resolve) => {
              developerState.resolveHooks = resolve;
            });
          })
        : vi.fn(
            async (input: {
              message: string;
              history: AppChatMessage[];
              existing?: AppProject | null;
            }) => {
              developerState.lastMessage = input.message;
              developerState.lastHistory = input.history;
              developerState.lastExisting = input.existing ?? null;
              return { response: developerState.reply, build: developerState.build };
            },
          ),
    };
  },
}));

vi.mock("@/lib/appsBuilder/preview", () => ({
  mountAppPreview: vi.fn(async () => () => undefined),
}));

function createClient() {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: null }),
      create: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockResolvedValue({ data: true }),
      update: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({ data: true }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: "anthropic",
              name: "Anthropic",
              env: [],
              models: {
                "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
              },
            },
          ],
          connected: ["anthropic"],
          default: { anthropic: "claude-3.5-sonnet" },
        },
      }),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
      auth: vi.fn().mockResolvedValue({ data: undefined }),
    },
    auth: { set: vi.fn(), remove: vi.fn() },
    question: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn(), reject: vi.fn() },
    permission: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    mcp: { connect: vi.fn(), disconnect: vi.fn() },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(qc: QueryClient) {
  qc.setQueryData(qk.providers, {
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        env: [],
        models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
      },
    ],
    connected: ["anthropic"],
    default: { anthropic: "claude-3.5-sonnet" },
  });
  qc.setQueryData(qk.config, {
    lastModel: "anthropic/claude-3.5-sonnet",
    hiddenModels: [],
    theme: "system",
    detailedAnalytics: "disabled",
  });
}

function renderBuilder(options: { openEditor?: boolean } = {}) {
  const { openEditor = true } = options;
  const client = createClient();
  const qc = createQueryClient();
  seedState(qc);
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <OpenCodeClientContext.Provider
          value={{
            client: client as never,
            status: "ready" as const,
            port: 4096,
            ready: true,
            initError: null,
            sseConnected: true,
            sseFailureCount: 0,
          }}
        >
          <PreferencesProvider>
            <AppsBuilder />
            <Toaster />
          </PreferencesProvider>
        </OpenCodeClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  if (openEditor) fireEvent.click(screen.getByTestId("new-app"));
  return { client, qc };
}

function generateApp(prompt = "Create a todo list app") {
  fireEvent.change(screen.getByTestId("app-prompt-input"), { target: { value: prompt } });
  fireEvent.click(screen.getByTestId("generate-app"));
  return waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());
}

beforeEach(() => {
  generateState.isPending = false;
  generateState.neverResolve = false;
  generateState.onProgress = null;
  generateState.onSessionReady = null;
  generateState.lastPrompt = "";
  generateState.lastExisting = null;
  generateState.lastSessionID = null;
  generateState.resolveHooks = null;
  generateState.callCount = 0;
  generateState.throwError = null;
  developerState.pending = false;
  developerState.neverResolve = false;
  developerState.build = true;
  developerState.reply = "On it — let's build that!";
  developerState.lastMessage = "";
  developerState.lastHistory = [];
  developerState.lastExisting = null;
  developerState.onDeltas = null;
  developerState.resolveHooks = null;
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
  document.createElement("a").click = vi.fn();
});

const APPS_KEY = "BloxMind-apps-studio-apps";

function savedAppsFromStorage(): SavedApp[] {
  const raw = window.localStorage.getItem(APPS_KEY);
  return raw ? (JSON.parse(raw) as SavedApp[]) : [];
}

describe("AppsBuilder", () => {
  it("renders the three-pane AI agent studio", () => {
    renderBuilder();

    expect(screen.getByText("AI Agent")).toBeTruthy();
    expect(screen.getByTestId("app-prompt-input")).toBeTruthy();
    expect(screen.getByText("Live Preview")).toBeTruthy();
    expect(screen.getByText("Explorer")).toBeTruthy();
  });

  it("generates a real app from a prompt and renders the preview", async () => {
    renderBuilder();

    const input = screen.getByTestId("app-prompt-input");
    fireEvent.change(input, { target: { value: "Create a todo list app" } });
    fireEvent.click(screen.getByTestId("generate-app"));

    expect(input).toHaveValue("");
    expect(screen.getByTestId("chat-message-user").textContent).toContain("Create a todo list app");

    await waitFor(() => {
      expect(screen.getByTestId("live-preview")).toBeTruthy();
      expect(screen.getAllByText(/Task Flow/).length).toBeGreaterThan(0);
      const assistants = screen.getAllByTestId("chat-message-assistant");
      expect(assistants[assistants.length - 1]?.textContent).toContain("is ready");
    });

    expect(screen.getAllByText(/4 files/).length).toBeGreaterThan(0);
  });

  it("switches preview between full-canvas and responsive device viewports", async () => {
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a weather app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());

    // Default is the full-canvas preview: no browser chrome or device mockup.
    expect(screen.queryByText("http://localhost:5173")).toBeNull();
    expect(screen.queryByTestId("viewport-desktop")).toBeNull();

    // Enabling the responsive device view reveals the viewport switcher.
    fireEvent.click(screen.getByTestId("device-view-toggle"));
    fireEvent.click(screen.getByTestId("viewport-desktop"));
    expect(screen.getByText("http://localhost:5173")).toBeTruthy();

    fireEvent.click(screen.getByTestId("viewport-mobile"));
    expect(screen.queryByText("http://localhost:5173")).toBeNull();

    // Disabling it returns to the full-canvas preview.
    fireEvent.click(screen.getByTestId("device-view-toggle"));
    expect(screen.queryByText("http://localhost:5173")).toBeNull();
    expect(screen.queryByTestId("viewport-desktop")).toBeNull();
  });

  it("shows generated project files in the explorer with syntax highlighting", async () => {
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a chat app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => {
      expect(screen.getByTestId("file-node-src/App.tsx")).toBeTruthy();
      expect(screen.getByTestId("code-editor")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("file-node-package.json"));
    expect(screen.getByTestId("code-editor")).toBeTruthy();
  });

  it("exposes the Export Project Zip option", async () => {
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a profile card app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());

    fireEvent.click(screen.getByTestId("export-app"));
    expect(screen.getByTestId("export-project-zip")).toBeTruthy();
  });

  it("shows a model switcher and lists connected models", () => {
    renderBuilder();

    expect(screen.getByTestId("model-picker")).toBeTruthy();
    expect(screen.getByText("claude-3.5-sonnet")).toBeTruthy();

    fireEvent.click(screen.getByText("claude-3.5-sonnet"));
    expect(screen.getByTestId("model-picker-dropdown")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Claude 3.5 Sonnet")).toBeTruthy();
  });

  it("shows a generation tip note while the app is being built", async () => {
    generateState.neverResolve = true;
    generateState.isPending = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a weather notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("generation-tip")).toBeTruthy());
    expect(screen.getByText(/Estimated time: around 7–10 minutes/)).toBeTruthy();
  });

  it("dismisses the generation tip for good when Done is clicked", async () => {
    generateState.neverResolve = true;
    generateState.isPending = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a weather notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("generation-tip")).toBeTruthy());
    fireEvent.click(screen.getByTestId("generation-tip-dismiss"));
    expect(screen.queryByTestId("generation-tip")).toBeNull();
    expect(window.localStorage.getItem("BloxMind-apps-studio-generation-tip-dismissed")).toBe("1");
  });

  it("advances the build status steps through real progress phases", async () => {
    generateState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());
    expect(screen.getByText("Building your project…")).toBeTruthy();
    expect(generateState.onProgress).not.toBeNull();

    act(() => generateState.onProgress?.("designing"));
    expect(screen.getByText("Building your project…")).toBeTruthy();

    act(() => generateState.onProgress?.("writing"));
    expect(screen.getByText("Building your project…")).toBeTruthy();

    act(() => generateState.onProgress?.("analyzing"));
    expect(screen.getByText("Building your project…")).toBeTruthy();

    act(() => generateState.onProgress?.("transpiling"));
    expect(screen.getByText("Building your project…")).toBeTruthy();

    act(() => generateState.onProgress?.("finalizing"));
    expect(screen.queryByTestId("activity-log")).toBeNull();
  });

  it("streams real agent tool calls into the activity log with status badges", async () => {
    generateState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));
    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());

    // Mirrors the real hook: the session resolves before the run streams.
    act(() => generateState.onSessionReady?.("session-1"));

    const sessionID = "session-1";
    const called = (tool: string, input: Record<string, unknown>) =>
      ({ id: "evt", type: "session.next.tool.called", properties: { sessionID, tool, input, callID: `call-${tool}` } });

    // A write streams in as a "running" entry with the exact path.
    act(() =>
      generateState.onActivity?.(
        called("write", { path: "src/components/SkyRacer.tsx" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Creating file/)).toBeTruthy(),
    );
    expect(screen.getByText("src/components/SkyRacer.tsx")).toBeTruthy();
    expect(screen.getByTestId("activity-running")).toBeTruthy();

    // A follow-up tool failure flips / adds an error badge with the message.
    act(() =>
      generateState.onActivity?.({
        id: "evt",
        type: "session.next.tool.failed",
        properties: { sessionID, callID: "call-write", error: { message: "line 42: cannot read" } },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Creating file failed/)).toBeTruthy(),
    );
    expect(screen.getByText("line 42: cannot read")).toBeTruthy();
    expect(screen.getByTestId("activity-error")).toBeTruthy();
  });

  it("shows the apps gallery home with an empty state when no app is open", () => {
    renderBuilder({ openEditor: false });

    expect(screen.getByText("Your Apps")).toBeTruthy();
    expect(screen.getByText("No apps yet")).toBeTruthy();
    expect(screen.getByTestId("new-app")).toBeTruthy();
  });

  it("saves a generated app and restores it from the gallery", async () => {
    renderBuilder();

    await generateApp();

    fireEvent.click(screen.getByTestId("save-app"));
    expect(savedAppsFromStorage()).toHaveLength(1);
    expect(savedAppsFromStorage()[0]).toMatchObject({
      id: "task-flow",
      name: "Task Flow",
      status: "in-progress",
    });
    expect(savedAppsFromStorage()[0].messages.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("back-to-apps"));
    expect(screen.getByText("Your Apps")).toBeTruthy();
    expect(screen.getByTestId("saved-app-task-flow")).toBeTruthy();

    fireEvent.click(screen.getByTestId("open-app-task-flow"));
    expect(screen.getByText("AI Agent")).toBeTruthy();
    expect(screen.getByTestId("chat-message-user").textContent).toContain("todo list");
    expect(screen.getAllByText(/Task Flow/).length).toBeGreaterThan(0);
  });

  it("deletes a saved app from the gallery", async () => {
    renderBuilder();

    await generateApp();
    fireEvent.click(screen.getByTestId("save-app"));
    fireEvent.click(screen.getByTestId("back-to-apps"));

    fireEvent.click(screen.getByTestId("delete-app-task-flow"));
    fireEvent.click(screen.getByTestId("delete-app-task-flow"));
    expect(savedAppsFromStorage()).toHaveLength(0);
    expect(screen.queryByTestId("saved-app-task-flow")).toBeNull();
    expect(screen.getByText("No apps yet")).toBeTruthy();
  });

  it("marks a saved app as completed when it is exported", async () => {
    renderBuilder();

    await generateApp();
    fireEvent.click(screen.getByTestId("save-app"));

    fireEvent.click(screen.getByTestId("export-app"));
    fireEvent.click(screen.getByTestId("export-project-zip"));

    expect(savedAppsFromStorage()[0].status).toBe("completed");
  });

  it("engages conversationally and does not build until the user clears it", async () => {
    developerState.build = false;
    developerState.reply = "Nice idea — should I fetch live weather data or use mock data?";
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Weather dashboard" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByText(developerState.reply)).toBeTruthy());
    expect(screen.getByTestId("chat-message-user").textContent).toContain("Weather dashboard");
    expect(screen.queryByTestId("live-preview")).toBeNull();
    expect(screen.queryByTestId("activity-log")).toBeNull();
    expect(generateState.lastPrompt).toBe("");
  });

  it("builds after the user confirms the plan, carrying conversation context", async () => {
    developerState.build = false;
    developerState.reply = "Mock data it is — anything else?";
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Weather dashboard with a 5-day forecast" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));
    await waitFor(() => expect(screen.getByText(developerState.reply)).toBeTruthy());
    expect(screen.queryByTestId("live-preview")).toBeNull();

    developerState.build = true;
    developerState.reply = "On it — mock-data weather app, coming right up.";
    fireEvent.change(screen.getByTestId("app-prompt-input"), { target: { value: "go ahead" } });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());
    expect(screen.getByText("On it — mock-data weather app, coming right up.")).toBeTruthy();
    expect(generateState.lastPrompt).toContain("Weather dashboard with a 5-day forecast");
    expect(generateState.lastPrompt).toContain("CONTEXT FROM OUR CONVERSATION");
  });

  it("streams conversational status updates into the chat log while building", async () => {
    generateState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());
    expect(screen.getByText(BUILD_STATUS_MESSAGES.analyzing)).toBeTruthy();

    act(() => generateState.onProgress?.("designing"));
    expect(screen.getByText(BUILD_STATUS_MESSAGES.designing)).toBeTruthy();

    act(() => generateState.onProgress?.("writing"));
    expect(screen.getByText(BUILD_STATUS_MESSAGES.writing)).toBeTruthy();

    act(() => generateState.onProgress?.("transpiling"));
    expect(screen.getByText(BUILD_STATUS_MESSAGES.transpiling)).toBeTruthy();
  });

  it("stops an in-progress build and leaves the studio ready for another prompt", async () => {
    generateState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());

    fireEvent.click(screen.getByTestId("stop-app"));

    await waitFor(() => expect(screen.queryByTestId("activity-log")).toBeNull());
    expect(screen.getByText(/Stopped/)).toBeTruthy();
    // The prompt is immediately usable again.
    expect(screen.getByTestId("app-prompt-input")).toBeTruthy();
    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Build a timer app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));
    await waitFor(() => expect(screen.getAllByTestId("chat-message-user").length).toBe(2));
  });

  it("stops while the agent is thinking and leaves the studio ready", async () => {
    developerState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "What do you think about a music app?" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("chat-thinking")).toBeTruthy());
    expect(developerState.pending).toBe(true);

    fireEvent.click(screen.getByTestId("stop-thinking"));

    await waitFor(() => expect(screen.queryByTestId("chat-thinking")).toBeNull());
    expect(screen.getByText(/Stopped/)).toBeTruthy();
    // The prompt is immediately usable again.
    expect(screen.getByTestId("app-prompt-input")).toBeTruthy();
  });

  it("queues a follow-up prompt while the app is building and applies it afterwards", async () => {
    generateState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));
    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());
    expect(generateState.isPending).toBe(true);

    // Sending while the build runs queues the message instead of killing it.
    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "add a search bar" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    const users = screen.getAllByTestId("chat-message-user");
    expect(users.length).toBe(2);
    expect(users[users.length - 1]?.textContent).toContain("search bar");
    expect(screen.getByText(/queued/i)).toBeTruthy();
    expect(screen.getByTestId("activity-log")).toBeTruthy();

    // First build completes.
    act(() => generateState.resolveHooks?.(appProject));
    await waitFor(() => expect(screen.getByText(/is ready/)).toBeTruthy());

    // The queued message now runs as an update to the built app.
    await waitFor(() => {
      expect(developerState.lastMessage).toBe("add a search bar");
      expect(developerState.lastExisting?.name).toBe("Task Flow");
    });

    // A second build is in flight for the queued change.
    expect(generateState.isPending).toBe(true);

    act(() => generateState.resolveHooks?.(appProject));
    await waitFor(() => {
      const assistants = screen.getAllByTestId("chat-message-assistant");
      expect(assistants.some((node) => node.textContent?.includes("updated"))).toBe(true);
    });
  });

  it("applies follow-up prompts to the existing app instead of generating a new one", async () => {
    renderBuilder();
    await generateApp();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "make the header blue and add a search bar" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => {
      expect(generateState.lastExisting).not.toBeNull();
      expect(generateState.lastExisting?.name).toBe("Task Flow");
      // The developer is told an app already exists so follow-ups don't stall.
      expect(developerState.lastExisting?.name).toBe("Task Flow");
      expect(generateState.lastPrompt).toContain("make the header blue and add a search bar");
    });

    // The updated project keeps its identity and the preview rebuilds.
    await waitFor(() => {
      const assistants = screen.getAllByTestId("chat-message-assistant");
      expect(assistants.some((node) => node.textContent?.includes("updated"))).toBe(true);
    });
    expect(screen.getByTestId("live-preview")).toBeTruthy();
  });

  it("keeps the first prompt as a fresh generation and only updates afterwards", async () => {
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));
    await waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());
    expect(generateState.lastExisting).toBeNull();
  });

  it("labels a follow-up change as an update, not a new build", async () => {
    renderBuilder();
    await generateApp();

    generateState.neverResolve = true;
    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "add a settings page" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("activity-log")).toBeTruthy());
    expect(screen.getByText(/Updating your project…/)).toBeTruthy();
    expect(screen.queryByText(/Building your project…/)).toBeNull();
    // Chat narrations use the update-flavored copy, not the fresh-build copy.
    expect(screen.getByText(/Let me figure out exactly what needs to change/)).toBeTruthy();
  });

  it("retries a transient upgrade failure and recovers", async () => {
    renderBuilder();
    await generateApp();

    generateState.throwError = "The generator returned an empty response.";
    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "add a search bar" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByText(/Let me try that again…/)).toBeTruthy());
    // The retried attempt produces a successful update.
    await waitFor(() => expect(screen.getByText(/updated — the changes are applied/)).toBeTruthy());
    // The retried attempt produces a successful update. mutateAsync was
    // called once for the initial build + twice for the upgrade (fail then retry).
    expect(generateState.callCount).toBe(3);
  });

  it("renders assistant messages as markdown, not raw text", async () => {
    developerState.build = false;
    developerState.reply =
      "**Got it** — I'll start with *mock data* and add a [live API](https://example.com).";
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Weather dashboard" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => {
      const assistants = screen.getAllByTestId("chat-message-assistant");
      const assistant = assistants[assistants.length - 1];
      expect(assistant?.querySelector("strong")?.textContent).toBe("Got it");
      expect(assistant?.querySelector("em")?.textContent).toBe("mock data");
      expect(assistant?.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    });
    // Raw markdown source must not leak into the visible text.
    const assistants = screen.getAllByTestId("chat-message-assistant");
    const assistant = assistants[assistants.length - 1];
    expect(assistant?.textContent).not.toContain("**Got it**");
  });

  it("streams the developer reply as a live typing bubble", async () => {
    developerState.neverResolve = true;
    renderBuilder();

    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "Create a notes app" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByTestId("chat-thinking")).toBeTruthy());

    // The studio subscribes to deltas and renders them live.
    expect(developerState.onDeltas).not.toBeNull();
    act(() => developerState.onDeltas?.("On it"));
    expect(screen.getByTestId("chat-thinking").textContent).toContain("On it");
    act(() => developerState.onDeltas?.("On it — building now"));
    expect(screen.getByTestId("chat-thinking").textContent).toContain("building now");

    // The bubble still offers a Stop button while streaming.
    expect(screen.getByTestId("stop-thinking")).toBeTruthy();
  });

  it("reuses the same persistent session across a transient failure retry", async () => {
    renderBuilder();
    await generateApp();

    generateState.throwError = "The generator returned an empty response.";
    fireEvent.change(screen.getByTestId("app-prompt-input"), {
      target: { value: "add a filter" },
    });
    fireEvent.click(screen.getByTestId("generate-app"));

    await waitFor(() => expect(screen.getByText(/updated — the changes are applied/)).toBeTruthy());
    // The failed attempt and its retry share the same session so edits stay in
    // the same on-disk folder.
    expect(generateState.lastSessionID).toBe("session-1");
    expect(generateState.callCount).toBe(3);
  });
});
