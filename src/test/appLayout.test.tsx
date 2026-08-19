/**
 * Layout regression tests for the apps-mode workspace.
 *
 * These guard against two regressions that shipped recently:
 *
 * 1. Panels collapsing to their content height, leaving a black dead zone at
 *    the bottom of the window. The apps-mode wrapper in Chat.tsx used to be a
 *    plain block div, which broke the `flex-1`/`min-h-0` height chain that
 *    runs from #root down into AppsBuilder. Every container in that chain must
 *    stay a growing, scroll-clipping flex column.
 *
 * 2. The three-column grid (AI Agent chat / Live Preview / Explorer) using
 *    hardcoded narrow widths (`w-48`, `w-60`, `w-80`) instead of proportional
 *    split so the panels scale with the window.
 *
 * jsdom cannot measure layout, so these tests assert the structural contract:
 * the exact utility classes that guarantee full-viewport height and flexible
 * column ratios.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppsBuilder } from "@/components/AppsBuilder";
import Chat from "@/components/Chat";
import { ThemeProvider } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { ModeProvider } from "@/providers/ModeProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

vi.mock("posthog-js/dist/module.full.no-external.js", () => ({ default: {} }));
vi.mock("@/lib/config", () => ({ loadConfig: () => Promise.resolve(null), patchConfig: () => {} }));
vi.mock("@/lib/appsBuilder/preview", () => ({ mountAppPreview: () => Promise.resolve(() => {}) }));
vi.mock("@/hooks/mutations/useGenerateApp", () => ({
  useGenerateApp: () => ({
    isPending: false,
    mutateAsync: () => Promise.resolve(null),
    abort: () => {},
  }),
}));
vi.mock("@/hooks/mutations/useDeveloperReply", () => ({
  useDeveloperReply: () => ({
    isPending: false,
    mutateAsync: () => Promise.resolve({ response: "", build: false }),
    abort: () => {},
  }),
}));

// Mock react-virtual so the full Chat tree mounts without viewport measurement.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: () => {},
  }),
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
      messages: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: {} }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
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
    question: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    permission: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    mcp: {
      status: vi.fn().mockResolvedValue({ data: {} }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(qc: QueryClient) {
  qc.setQueryData(qk.sessions, []);
  qc.setQueryData(qk.statuses, {});
  qc.setQueryData(qk.agents, []);
  qc.setQueryData(qk.providers, {
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
  });
  qc.setQueryData(qk.config, {
    lastModel: "anthropic/claude-3.5-sonnet",
    defaultVariant: undefined,
  });
}

/** Renders the real Chat tree in apps mode (mode comes from localStorage). */
function renderAppsMode() {
  window.localStorage.setItem("BloxMind-active-mode", "apps");
  const qc = createQueryClient();
  seedState(qc);
  const client = createClient() as never;

  function Wrapper() {
    const activeSessionIdRef = useRef<string | null>(null);
    useEffect(() => {
      activeSessionIdRef.current = "sess-1";
    }, []);
    return (
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ModeProvider>
            <OpenCodeClientContext.Provider
              value={{
                client,
                status: "ready",
                port: 4096,
                ready: true,
                initError: null,
                sseConnected: true,
                sseFailureCount: 0,
              }}
            >
              <ActiveSessionContext.Provider
                value={{
                  activeSessionId: "sess-1",
                  selectSession: () => Promise.resolve(),
                  clearSession: () => {},
                  activeSessionIdRef,
                }}
              >
                <PreferencesProvider>
                  <Chat />
                </PreferencesProvider>
              </ActiveSessionContext.Provider>
            </OpenCodeClientContext.Provider>
          </ModeProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  render(<Wrapper />);

  // Open the apps editor: the three-pane workspace only renders once an app
  // is being built (AppsBuilder shows the gallery before that).
  fireEvent.click(screen.getByTestId("new-app"));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("apps-mode full-height layout chain", () => {
  it("keeps the apps-mode root and workspace wrapper as growing flex columns", () => {
    renderAppsMode();

    const root = screen.getByTestId("apps-mode-root");
    const wrapper = screen.getByTestId("apps-mode-workspace");
    const grid = screen.getByTestId("apps-workspace-grid");

    // Every link in the chain from Chat down to the pane grid must be a flex
    // column that can grow (flex-1) and shrink below content size (min-h-0).
    // A plain block div here collapses everything to content height and leaves
    // a black dead zone at the bottom of the window.
    expect(root.className).toContain("flex");
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("overflow-hidden");

    expect(wrapper.className).toContain("flex");
    expect(wrapper.className).toContain("flex-col");
    expect(wrapper.className).toContain("min-h-0");
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).not.toBe("hidden");

    // The pane row fills the remaining height and clips its own overflow.
    expect(grid.className).toContain("flex");
    expect(grid.className).toContain("min-h-0");
    expect(grid.className).toContain("w-full");
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("overflow-hidden");
  });
});

describe("apps-mode three-column proportional grid", () => {
  it("renders all three panes without hardcoded narrow column widths", () => {
    renderAppsMode();

    const agent = screen.getByTestId("apps-chat-pane");
    const preview = screen.getByTestId("apps-preview-pane");
    const explorer = screen.getByTestId("apps-explorer-pane");

    // AI Agent chat column: proportional split (flex-basis clamp), never a
    // fixed px/narrow width that leaves the chat box cramped.
    expect(agent.className).toContain("basis-[clamp(");
    expect(agent.className).toContain("shrink-0");
    expect(agent.className).not.toMatch(/\bw-(48|60|72|80|96)\b/);

    // Live Preview: takes the flexible remainder.
    expect(preview.className).toContain("flex-1");
    expect(preview.className).toContain("min-w-0");

    // Explorer column: proportional split, not a fixed wide w-80.
    expect(explorer.className).toContain("basis-[clamp(");
    expect(explorer.className).toContain("shrink-0");
    expect(explorer.className).not.toMatch(/\bw-(48|60|72|80|96)\b/);
  });
});

describe("AppsBuilder layout contract (rendered standalone)", () => {
  it("exposes the three proportional panes and the full-height grid", () => {
    const qc = createQueryClient();
    seedState(qc);
    const client = createClient() as never;
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <OpenCodeClientContext.Provider
            value={{
              client,
              status: "ready",
              port: 4096,
              ready: true,
              initError: null,
              sseConnected: true,
              sseFailureCount: 0,
            }}
          >
            <PreferencesProvider>
              <AppsBuilder />
            </PreferencesProvider>
          </OpenCodeClientContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // The gallery is shown until an app is opened; the proportional grid with
    // the three panes is what we are guarding, so open the editor first.
    fireEvent.click(screen.getByTestId("new-app"));

    const grid = screen.getByTestId("apps-workspace-grid");
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("w-full");
    expect(grid.className).toContain("overflow-hidden");
  });
});
