import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameStudio } from "@/components/GameStudio";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { AppChatMessage, AppProject } from "@/lib/appsBuilder/types";
import { qk } from "@/lib/queryKeys";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

const gameProject: AppProject = {
  name: "Sky Racers",
  description: "A low-poly racing game",
  target: "desktop",
  theme: "dark",
  engine: "3d",
  entry: "src/main.tsx",
  files: [
    { path: "package.json", content: '{ "name": "sky-racers" }' },
    { path: "src/main.tsx", content: 'import App from "./App";' },
    { path: "src/App.tsx", content: "export default function App() { return <h1>Game</h1>; }" },
    { path: "src/index.css", content: "body { margin: 0; }" },
  ],
};

const { generateState, developerState } = vi.hoisted(() => ({
  generateState: {
    isPending: false,
    neverResolve: false,
    onProgress: null as null | ((phase: string) => void),
    onSessionReady: null as null | ((sessionID: string) => void),
    lastPrompt: "",
    lastExisting: null as null | AppProject,
    lastSessionID: null as null | string,
    lastEngine: null as null | string | undefined,
    resolveHooks: null as null | ((value: AppProject | null) => void),
    callCount: 0,
    throwError: null as null | string,
  },
  developerState: {
    pending: false,
    neverResolve: false,
    build: true,
    reply: "On it — let's build that game!",
    lastMessage: "",
    lastHistory: [] as AppChatMessage[],
    lastExisting: null as null | AppProject,
    resolveHooks: null as null | ((value: { response: string; build: boolean } | null) => void),
  },
}));

vi.mock("@/hooks/mutations/useGenerateApp", () => ({
  useGenerateApp: (options?: {
    onProgress?: (phase: string) => void;
    onSessionReady?: (sessionID: string) => void;
  }) => {
    generateState.onProgress = options?.onProgress ?? null;
    generateState.onSessionReady = options?.onSessionReady ?? null;
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
              engine?: string;
            }) => {
              generateState.lastPrompt = input.request;
              generateState.lastExisting = input.existing ?? null;
              generateState.lastSessionID = input.sessionID ?? null;
              generateState.lastEngine = input.engine;
              generateState.isPending = true;
              generateState.callCount++;
              generateState.onSessionReady?.(input.sessionID ?? "game-session-1");
              if (generateState.throwError) {
                const message = generateState.throwError;
                generateState.throwError = null;
                generateState.isPending = false;
                throw new Error(message);
              }
              generateState.isPending = false;
              return gameProject;
            },
          ),
    };
  },
}));

vi.mock("@/hooks/mutations/useDeveloperReply", () => ({
  useDeveloperReply: (_options?: { onDeltas?: (accumulated: string) => void }) => {
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

function renderStudio() {
  const client = createClient();
  const qc = createQueryClient();
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
            <GameStudio />
            <Toaster />
          </PreferencesProvider>
        </OpenCodeClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTestId("new-game"));
  return { client, qc };
}

beforeEach(() => {
  generateState.isPending = false;
  generateState.neverResolve = false;
  generateState.onProgress = null;
  generateState.onSessionReady = null;
  generateState.lastPrompt = "";
  generateState.lastExisting = null;
  generateState.lastSessionID = null;
  generateState.lastEngine = null;
  generateState.resolveHooks = null;
  generateState.callCount = 0;
  generateState.throwError = null;
  developerState.pending = false;
  developerState.neverResolve = false;
  developerState.build = true;
  developerState.reply = "On it — let's build that game!";
  developerState.lastMessage = "";
  developerState.lastHistory = [];
  developerState.lastExisting = null;
  developerState.resolveHooks = null;
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("confirm", () => true);
});

describe("GameStudio", () => {
  it("renders the game-focused studio UI", () => {
    renderStudio();

    expect(screen.getByText("AI Game Designer")).toBeTruthy();
    expect(screen.getByTestId("game-prompt-input")).toBeTruthy();
    expect(screen.getByText("Live Game Preview")).toBeTruthy();
    expect(screen.getByText("Explorer")).toBeTruthy();
  });

  it("always routes fresh builds through the 3D game engine", async () => {
    renderStudio();

    fireEvent.change(screen.getByTestId("game-prompt-input"), {
      target: { value: "Build a low-poly racing game" },
    });
    fireEvent.click(screen.getByTestId("generate-game"));

    await waitFor(() => {
      expect(generateState.lastPrompt).toContain("racing game");
      expect(generateState.lastEngine).toBe("3d");
    });

    await waitFor(() => {
      expect(screen.getByTestId("live-preview")).toBeTruthy();
      const assistants = screen.getAllByTestId("chat-message-assistant");
      expect(assistants.some((node) => node.textContent?.includes("is ready to play"))).toBe(true);
    });
  });

  it("saves games into the games-only gallery", async () => {
    renderStudio();

    fireEvent.change(screen.getByTestId("game-prompt-input"), {
      target: { value: "Build a platformer game" },
    });
    fireEvent.click(screen.getByTestId("generate-game"));

    await waitFor(() => expect(screen.getByTestId("live-preview")).toBeTruthy());
    fireEvent.click(screen.getByTestId("save-game"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("back-to-games"));
    });

    expect(screen.getByText("Your Games")).toBeTruthy();
    expect(screen.getByTestId("saved-game-sky-racers")).toBeTruthy();
  });
});