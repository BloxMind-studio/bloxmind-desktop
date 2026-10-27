/**
 * Unit tests for the RAM-scoped checkpoint history hook.
 *
 * Regression coverage for the checkpoint UI rules:
 *  - only checkpoints captured during this app run surface UI (never disk
 *    leftovers from a previous run),
 *  - the RAM view is kept per session and re-syncs on session switches,
 *  - "Restored" markers reset when a new checkpoint is captured.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckpointHistory } from "@/hooks/useCheckpointHistory";
import type { Checkpoint } from "@/types/checkpoints";

const { restoreMock, listMock } = vi.hoisted(() => ({
  restoreMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock("@/hooks/useCheckpoints", () => ({
  useCheckpoints: () => ({
    capture: vi.fn(),
    restore: restoreMock,
    preview: vi.fn(),
    changed: vi.fn(),
    list: listMock,
    validate: vi.fn(),
  }),
}));

vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: null, ready: true }),
}));

function makeCheckpoint(id: string, sessionId: string, messageId: string | null): Checkpoint {
  return {
    id,
    parentId: null,
    timestamp: Date.now(),
    sessionId,
    messageId,
    kind: "pre-exec",
    tool: "session.promptAsync",
    paths: [],
    gitRef: null,
    failureLog: null,
    fullSnapshot: true,
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCheckpointHistory (RAM-scoped)", () => {
  it("starts empty even though checkpoints exist on disk", () => {
    listMock.mockResolvedValue([makeCheckpoint("cp_disk", "s1", "m0")]);
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });

    expect(result.current.liveCheckpoints).toEqual([]);
    // The hook never asks the main process for older checkpoints.
    expect(listMock).not.toHaveBeenCalled();
  });

  it("records captured checkpoints in order", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });

    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });
    expect(result.current.liveCheckpoints.map((c) => c.id)).toEqual(["cp1"]);

    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp2", "s1", "m2"));
    });
    expect(result.current.liveCheckpoints.map((c) => c.id)).toEqual(["cp1", "cp2"]);
  });

  it("replaces an existing entry when the same message is re-captured", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1b", "s1", "m1"));
    });
    expect(result.current.liveCheckpoints.map((c) => c.id)).toEqual(["cp1b"]);
  });

  it("keeps RAM per session and resets the view when the session switches", () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useCheckpointHistory(sessionId),
      { wrapper: makeWrapper(), initialProps: { sessionId: "s1" } },
    );

    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });
    expect(result.current.liveCheckpoints).toHaveLength(1);

    rerender({ sessionId: "s2" });
    expect(result.current.liveCheckpoints).toEqual([]);

    rerender({ sessionId: "s1" });
    expect(result.current.liveCheckpoints.map((c) => c.id)).toEqual(["cp1"]);
  });

  it("ignores captures belonging to a different session", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp_other", "s2", "m9"));
    });
    expect(result.current.liveCheckpoints).toEqual([]);
  });

  it("does not restore when no checkpoint was captured this run", async () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    let restored: unknown = "unset";
    await act(async () => {
      restored = await result.current.restoreLatestFileCheckpoint("m1");
    });
    expect(restored).toBeNull();
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restores the live checkpoint captured for that message", async () => {
    restoreMock.mockResolvedValue({
      restoredId: "cp1",
      message: "Restored 2 files",
      filesChanged: ["a.lua"],
    });
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp2", "s1", "m2"));
    });

    await act(async () => {
      await result.current.restoreLatestFileCheckpoint("m1");
    });
    expect(restoreMock).toHaveBeenLastCalledWith({
      checkpointId: "cp1",
      sessionId: "s1",
      dryRun: false,
      preserveUserEdits: false,
    });
    expect(result.current.restoredMessageId).toBe("m1");
  });

  it("does not restore another turn's checkpoint when the message has none", async () => {
    restoreMock.mockResolvedValue({ restoredId: "cp2", message: "ok", filesChanged: [] });
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp2", "s1", "m2"));
    });

    let restored: unknown = "unset";
    await act(async () => {
      restored = await result.current.restoreLatestFileCheckpoint("m_unknown");
    });
    expect(restored).toBeNull();
    expect(restoreMock).not.toHaveBeenCalled();
    expect(result.current.restoredMessageId).toBeNull();
  });

  it("marks a turn as changed only once the check says so", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });

    // Nothing is known about the turn yet, so it earns no badge.
    expect(result.current.checkpointForTurn("m1")).toMatchObject({ changed: false });

    act(() => {
      result.current.recordTurnChange("cp1", true);
    });
    expect(result.current.checkpointForTurn("m1")).toMatchObject({ changed: true });

    act(() => {
      result.current.recordTurnChange("cp1", false);
    });
    expect(result.current.checkpointForTurn("m1")).toMatchObject({ changed: false });
  });

  it("has no checkpoint for a message that never started a turn", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });
    expect(result.current.checkpointForTurn("m_other")).toBeNull();
  });

  it("forgets a turn's outcome when the same message is re-captured", () => {
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
      result.current.recordTurnChange("cp1", true);
    });
    expect(result.current.checkpointForTurn("m1")?.changed).toBe(true);

    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1b", "s1", "m1"));
    });
    expect(result.current.checkpointForTurn("m1")).toMatchObject({
      checkpoint: { id: "cp1b" },
      changed: false,
    });
  });

  it("clears the outcome after a successful restore", async () => {
    restoreMock.mockResolvedValue({ restoredId: "cp1", message: "ok", filesChanged: [] });
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
      result.current.recordTurnChange("cp1", true);
    });

    await act(async () => {
      await result.current.restoreLatestFileCheckpoint("m1");
    });

    // Files are back at the checkpoint, so only the "Restored" marker remains.
    expect(result.current.checkpointForTurn("m1")?.changed).toBe(false);
    expect(result.current.restoredMessageId).toBe("m1");
  });

  it("keeps a failed restore pending", async () => {
    restoreMock.mockRejectedValue(new Error("journal missing"));
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
      result.current.recordTurnChange("cp1", true);
    });

    await act(async () => {
      await result.current.restoreLatestFileCheckpoint("m1");
    });

    expect(result.current.checkpointForTurn("m1")?.changed).toBe(true);
    expect(result.current.restoredMessageId).toBeNull();
  });

  it("clears the Restored marker when a new checkpoint is captured", async () => {
    restoreMock.mockResolvedValue({ restoredId: "cp1", message: "ok", filesChanged: [] });
    const { result } = renderHook(() => useCheckpointHistory("s1"), { wrapper: makeWrapper() });
    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp1", "s1", "m1"));
    });
    await act(async () => {
      await result.current.restoreLatestFileCheckpoint("m1");
    });
    expect(result.current.restoredMessageId).toBe("m1");

    act(() => {
      result.current.recordCapturedCheckpoint(makeCheckpoint("cp2", "s1", "m2"));
    });
    expect(result.current.restoredMessageId).toBeNull();
  });
});
