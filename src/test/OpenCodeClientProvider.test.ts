import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { latchedBusySessions } from "@/hooks/useSessionStatuses";
import { qk } from "@/lib/queryKeys";
import {
  markBusySessionsInterrupted,
  prefetchServerState,
  reconcileServerState,
} from "@/providers/OpenCodeClientProvider";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

describe("OpenCode query lifecycle", () => {
  it("keeps successful startup snapshots when another endpoint fails", async () => {
    const client = {
      experimental: {
        session: { list: vi.fn().mockRejectedValue(new Error("sessions unavailable")) },
      },
      session: {
        status: vi.fn().mockResolvedValue({ data: { s1: { type: "idle" } } }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({
          data: { all: [], connected: [], default: {} },
        }),
        auth: vi.fn().mockRejectedValue(new Error("auth unavailable")),
      },
      app: {
        agents: vi.fn().mockResolvedValue({ data: [{ name: "build", mode: "primary" }] }),
      },
    } as unknown as OpencodeClient;
    const queryClient = makeQueryClient();

    await expect(prefetchServerState(client, queryClient)).resolves.toBeUndefined();

    expect(queryClient.getQueryData(qk.sessions)).toBeUndefined();
    expect(queryClient.getQueryData(qk.statuses)).toEqual({ s1: { type: "idle" } });
    expect(queryClient.getQueryData(qk.providers)).toEqual({
      all: [],
      connected: [],
      default: {},
    });
    expect(queryClient.getQueryData(qk.agents)).toEqual([{ name: "build", mode: "primary" }]);
  });

  it("fails startup when every server-state endpoint is unavailable", async () => {
    const unavailable = vi.fn().mockRejectedValue(new Error("unavailable"));
    const client = {
      experimental: { session: { list: unavailable } },
      session: { status: unavailable },
      provider: { list: unavailable, auth: unavailable },
      app: { agents: unavailable },
    } as unknown as OpencodeClient;

    await expect(prefetchServerState(client, makeQueryClient())).rejects.toThrow(
      "OpenCode server state is unavailable",
    );
  });

  it("invalidates every active-session snapshot after SSE connects", async () => {
    const queryClient = makeQueryClient();
    const activeKeys = [
      qk.sessions,
      qk.statuses,
      qk.providers,
      qk.agents,
      qk.messages("s1"),
      qk.todos("s1"),
      qk.questions("s1"),
      qk.permissions("s1"),
    ];
    for (const queryKey of activeKeys) queryClient.setQueryData(queryKey, {});
    queryClient.setQueryData(qk.messages("s2"), {});

    await reconcileServerState(queryClient, "s1");

    for (const queryKey of activeKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(qk.messages("s2"))?.isInvalidated).toBe(false);
  });
});

describe("markBusySessionsInterrupted", () => {
  it("persists interrupted markers for busy sessions at close time", () => {
    window.localStorage.clear();
    const queryClient = makeQueryClient();
    queryClient.setQueryData(qk.statuses, {
      s1: { type: "busy" },
      s2: { type: "idle" },
    });

    markBusySessionsInterrupted(queryClient);

    expect(window.localStorage.getItem("BloxMind:interrupted:s1")).toBeTruthy();
    expect(window.localStorage.getItem("BloxMind:interrupted:s2")).toBeNull();
  });

  it("also marks sessions held by the busy latch when the status cache omitted them", () => {
    window.localStorage.clear();
    const queryClient = makeQueryClient();
    // The engine dropped status events mid-turn: the cache holds nothing for
    // s3, but useIsBusy's latch still reports it busy.
    queryClient.setQueryData(qk.statuses, {});
    latchedBusySessions.add("s3");
    try {
      markBusySessionsInterrupted(queryClient);
    } finally {
      latchedBusySessions.delete("s3");
    }

    expect(window.localStorage.getItem("BloxMind:interrupted:s3")).toBeTruthy();
  });
});
