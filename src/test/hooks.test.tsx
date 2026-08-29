/**
 * Unit tests for data-fetching hooks:
 *   useSessions
 *   useProviders (useAllProviders, useConnectedProviders, useAllModels, useAuthMethods)
 *   useMessages (useMessageIds, useMessage)
 *   useSessionStatuses / useIsBusy
 */

import type { Session, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessage, useMessageIds } from "@/hooks/useMessages";
import {
  useAllModels,
  useAllProviders,
  useAuthMethods,
  useConnectedProviders,
} from "@/hooks/useProviders";
import { useIsBusy, useSessionStatuses } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { makeAssistantMessage, makeTextPart } from "@/test/fixtures";

// ── Test helpers ─────────────────────────────────────────────────────

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function makeSession(id: string, title: string): Session {
  return {
    id,
    title,
    slug: id,
    projectID: "proj",
    directory: "/workspace",
    time: { created: Date.now(), updated: Date.now() },
    version: "1",
    parentID: "",
  };
}

/** Minimal wrapper providing QueryClient only */
function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

/** Wrapper providing QueryClient + ActiveSession context */
function makeSessionWrapper(qc: QueryClient, activeSessionId: string | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const ref = useRef<string | null>(activeSessionId);
    return (
      <QueryClientProvider client={qc}>
        <ActiveSessionContext.Provider
          value={{
            activeSessionId,
            selectSession: async () => {},
            clearSession: () => {},
            activeSessionIdRef: ref,
          }}
        >
          {children}
        </ActiveSessionContext.Provider>
      </QueryClientProvider>
    );
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useSessions ──────────────────────────────────────────────────────

describe("useSessions", () => {
  it("returns sessions from the query cache", () => {
    const qc = makeQC();
    const sessions = [makeSession("s1", "One"), makeSession("s2", "Two")];
    qc.setQueryData(qk.sessions, sessions);

    const { result } = renderHook(() => useSessions(), { wrapper: makeWrapper(qc) });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].id).toBe("s1");
  });

  it("returns undefined when cache is empty", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useSessions(), { wrapper: makeWrapper(qc) });
    expect(result.current.data).toBeUndefined();
  });
});

// ── useProviders ─────────────────────────────────────────────────────

describe("useAllProviders", () => {
  it("maps provider data to ProviderInfo array", () => {
    const qc = makeQC();
    qc.setQueryData(qk.providers, {
      all: [
        { id: "anthropic", name: "Anthropic", env: ["ANTHROPIC_API_KEY"], models: {} },
        { id: "openai", name: "OpenAI", env: [], models: {} },
      ],
      connected: [],
    });

    const { result } = renderHook(() => useAllProviders(), { wrapper: makeWrapper(qc) });

    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toEqual({
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
    });
  });

  it("returns empty array when no data", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useAllProviders(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual([]);
  });
});

describe("useConnectedProviders", () => {
  it("returns connected provider IDs", () => {
    const qc = makeQC();
    qc.setQueryData(qk.providers, {
      all: [],
      connected: ["anthropic", "openai"],
    });

    const { result } = renderHook(() => useConnectedProviders(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual(["anthropic", "openai"]);
  });

  it("returns empty array when no data", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useConnectedProviders(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual([]);
  });
});

describe("useAllModels", () => {
  it("flattens models from all providers", () => {
    const qc = makeQC();
    qc.setQueryData(qk.providers, {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          env: [],
          models: {
            "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
            "claude-3-opus": { id: "claude-3-opus", name: "Claude 3 Opus", status: "beta" },
          },
        },
        {
          id: "openai",
          name: "OpenAI",
          env: [],
          models: {
            "gpt-4": { id: "gpt-4", name: "GPT-4" },
          },
        },
      ],
      connected: [],
    });

    const { result } = renderHook(() => useAllModels(), { wrapper: makeWrapper(qc) });

    expect(result.current).toHaveLength(3);
    expect(result.current[0]).toMatchObject({
      id: "claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
    });
    expect(result.current[1].status).toBe("beta");
    expect(result.current[2].providerId).toBe("openai");
  });
});

describe("useAuthMethods", () => {
  it("returns auth methods when available", () => {
    const qc = makeQC();
    const authMethods = { anthropic: [{ type: "api_key" }] };
    qc.setQueryData(qk.providers, { all: [], connected: [], authMethods });

    const { result } = renderHook(() => useAuthMethods(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual(authMethods);
  });

  it("returns empty object when no auth methods", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useAuthMethods(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual({});
  });
});

// ── useMessages ──────────────────────────────────────────────────────

describe("useMessageIds", () => {
  it("returns message IDs for the active session", () => {
    const qc = makeQC();
    qc.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: ["m1", "m2"],
      messagesById: {
        m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
        m2: { info: makeAssistantMessage({ id: "m2" }), parts: [] },
      },
    });

    const { result } = renderHook(() => useMessageIds(), {
      wrapper: makeSessionWrapper(qc, "s1"),
    });

    expect(result.current).toEqual(["m1", "m2"]);
  });

  it("returns empty array when no active session", () => {
    const qc = makeQC();
    const { result } = renderHook(() => useMessageIds(), {
      wrapper: makeSessionWrapper(qc, null),
    });
    expect(result.current).toEqual([]);
  });
});

describe("useMessage", () => {
  it("returns a specific message by ID", () => {
    const qc = makeQC();
    qc.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: ["m1"],
      messagesById: {
        m1: {
          info: makeAssistantMessage({ id: "m1" }),
          parts: [makeTextPart({ text: "hello" })],
        },
      },
    });

    const { result } = renderHook(() => useMessage("m1"), {
      wrapper: makeSessionWrapper(qc, "s1"),
    });

    expect(result.current?.info.id).toBe("m1");
    expect(result.current?.parts).toHaveLength(1);
  });

  it("returns undefined for a non-existent message", () => {
    const qc = makeQC();
    qc.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: ["m1"],
      messagesById: { m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] } },
    });

    const { result } = renderHook(() => useMessage("m999"), {
      wrapper: makeSessionWrapper(qc, "s1"),
    });

    expect(result.current).toBeUndefined();
  });
});

// ── useSessionStatuses / useIsBusy ───────────────────────────────────

describe("useSessionStatuses", () => {
  it("returns statuses from cache", () => {
    const qc = makeQC();
    const statuses = {
      s1: { type: "busy" } as SessionStatus,
      s2: { type: "idle" } as SessionStatus,
    };
    qc.setQueryData(qk.statuses, statuses);

    const { result } = renderHook(() => useSessionStatuses(), { wrapper: makeWrapper(qc) });

    expect(result.current.data).toEqual(statuses);
  });
});

describe("useIsBusy", () => {
  it("returns true when session is busy", () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });

    const { result } = renderHook(() => useIsBusy("s1"), { wrapper: makeWrapper(qc) });

    expect(result.current).toBe(true);
  });

  it("returns false when session is idle", () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });

    const { result } = renderHook(() => useIsBusy("s1"), { wrapper: makeWrapper(qc) });

    expect(result.current).toBe(false);
  });

  it("returns false when sessionId is null", () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });

    const { result } = renderHook(() => useIsBusy(null), { wrapper: makeWrapper(qc) });

    expect(result.current).toBe(false);
  });

  it("holds busy across a transient idle blip between agent steps", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      // Transient session.idle mid-loop (e.g. after a tool batch).
      act(() => {
        qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });
        rerender();
      });
      expect(result.current).toBe(true); // latched inside the confirm window

      // Busy returns before the window elapses (next tool step starts).
      act(() => {
        qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
        rerender();
      });
      expect(result.current).toBe(true);

      // Sustained idle past the confirm window unlocks.
      act(() => {
        qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });
        rerender();
      });
      act(() => {
        vi.advanceTimersByTime(2_100);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not latch for sessions that were never busy", () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });

    const { result } = renderHook(() => useIsBusy("s1"), { wrapper: makeWrapper(qc) });

    expect(result.current).toBe(false);
  });

  it("clears the latch when switching to another session", () => {
    const qc = makeQC();
    qc.setQueryData(qk.statuses, {
      s1: { type: "busy" } as SessionStatus,
      s2: { type: "idle" } as SessionStatus,
    });

    const { result, rerender } = renderHook(({ id }) => useIsBusy(id), {
      wrapper: makeWrapper(qc),
      initialProps: { id: "s1" },
    });
    expect(result.current).toBe(true);

    act(() => {
      rerender({ id: "s2" });
    });
    // No latch bleed from s1's busy state into the idle s2.
    expect(result.current).toBe(false);
  });

  it("keeps the Stop latch through an unknown/loading status blip", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      // A background refetch momentarily exposes no status data. This must
      // NEVER unlock the latch — "unknown" is not evidence the agent stopped.
      act(() => {
        qc.removeQueries({ queryKey: qk.statuses });
        rerender();
      });
      expect(result.current).toBe(true);

      // Watchdog reconciles with a real idle; unlock only after it persists.
      act(() => {
        qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });
        rerender();
      });
      expect(result.current).toBe(true); // still inside the confirm window

      act(() => {
        vi.advanceTimersByTime(2_100);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks when the status stays unknown past the grace window", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      // The engine dropped the idle SSE event and the watchdog poll now omits
      // the settled session from the status map entirely — the status stays
      // undefined. The Stop button must NOT stay latched forever (grace 30s).
      act(() => {
        qc.removeQueries({ queryKey: qk.statuses });
        rerender();
      });
      act(() => {
        vi.advanceTimersByTime(29_900);
      });
      expect(result.current).toBe(true); // still inside the unknown grace

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-latches when busy returns during the unknown grace window", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      // Status disappears (dropped events) but the agent is still running —
      // the next busy observation must cancel the pending unlock.
      act(() => {
        qc.removeQueries({ queryKey: qk.statuses });
        rerender();
      });
      act(() => {
        qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
        rerender();
      });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the latch while messages keep streaming during unknown status", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      // The engine drops status events mid-turn: the status disappears while
      // the agent is still working. Message deltas keep arriving, and that
      // activity must restart the unknown grace window (now 30s) so the Stop
      // button never flips to Send mid-turn.
      act(() => {
        qc.removeQueries({ queryKey: qk.statuses });
        rerender();
      });

      // Stream message updates across two grace windows (grace 30s).
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      act(() => {
        qc.setQueryData<MessagesCache>(qk.messages("s1"), {
          messageIds: ["m1"],
          messagesById: {
            m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
          },
        });
        rerender();
      });
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      act(() => {
        qc.setQueryData<MessagesCache>(qk.messages("s1"), {
          messageIds: ["m1", "m2"],
          messagesById: {
            m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
            m2: { info: makeAssistantMessage({ id: "m2" }), parts: [] },
          },
        });
        rerender();
      });

      // 30s have passed since the status vanished — at the grace boundary —
      // but the stream only went quiet 15s ago. The latch must still hold.
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(result.current).toBe(true);

      // Once the stream has been quiet for a full grace window (30s), unlock.
      act(() => {
        vi.advanceTimersByTime(15_100);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks a full grace window after the last message activity during unknown status", async () => {
    vi.useFakeTimers();
    try {
      const qc = makeQC();
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const { result, rerender } = renderHook(() => useIsBusy("s1"), {
        wrapper: makeWrapper(qc),
      });
      expect(result.current).toBe(true);

      act(() => {
        qc.removeQueries({ queryKey: qk.statuses });
        rerender();
      });

      // One late message part flushes 15s into the unknown window (grace 30s),
      // then the stream settles. The unlock must happen a full grace window
      // after the LAST activity, not after the status first vanished.
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      act(() => {
        qc.setQueryData<MessagesCache>(qk.messages("s1"), {
          messageIds: ["m1"],
          messagesById: {
            m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
          },
        });
        rerender();
      });
      act(() => {
        vi.advanceTimersByTime(29_900);
      });
      expect(result.current).toBe(true); // restarted grace still running

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
