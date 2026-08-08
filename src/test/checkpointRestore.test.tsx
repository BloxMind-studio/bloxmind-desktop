/**
 * Regression tests for the checkpoint restore flow (useCheckpointHistory):
 * restoring a checkpoint must silently rewind the agent's conversation
 * context via session.revert (the same API undo/redo use), and must NEVER
 * inject a visible session.prompt() into the chat — that used to surface an
 * ugly "[SYSTEM_NOTIFICATION_RESTORE]" user message and trigger an agent
 * reply, forcing users to manage restore context by hand.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckpointHistory } from "@/hooks/useCheckpointHistory";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import type { Checkpoint } from "@/types/checkpoints";

// ── Desktop bridge mock ────────────────────────────────────────────────────

const desktopMock = vi.hoisted(() => ({
  checkpointList: vi.fn(),
  checkpointRestore: vi.fn(),
}));

vi.mock("@/lib/desktop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop")>();
  return {
    ...actual,
    desktop: {
      ...actual.desktop,
      checkpointList: (...args: unknown[]) => desktopMock.checkpointList(...args),
      checkpointRestore: (...args: unknown[]) => desktopMock.checkpointRestore(...args),
    },
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

const SESSION_ID = "s1";

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "cp-1",
    parentId: null,
    timestamp: Date.now(),
    sessionId: SESSION_ID,
    messageId: "msg-prompt-1",
    kind: "pre-exec",
    tool: null,
    paths: [],
    gitRef: null,
    failureLog: null,
    fullSnapshot: true,
    ...overrides,
  };
}

function makeFakeClient() {
  return {
    session: {
      revert: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      unrevert: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      prompt: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
    },
  };
}

function makeQC(messageIds: string[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  const cache: MessagesCache = { messageIds, messagesById: {} };
  qc.setQueryData(qk.messages(SESSION_ID), cache);
  return qc;
}

function makeWrapper(qc: QueryClient, fakeClient: ReturnType<typeof makeFakeClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <OpenCodeClientContext.Provider
          value={{
            client: fakeClient as unknown as OpencodeClient,
            status: "ready",
            port: 34999,
            ready: true,
            initError: null,
          }}
        >
          {children}
        </OpenCodeClientContext.Provider>
      </QueryClientProvider>
    );
  };
}

function seedRestoreSuccess() {
  desktopMock.checkpointRestore.mockResolvedValue({
    restoredId: "cp-1",
    message: "Reverted to checkpoint",
    filesChanged: ["src/server.lua"],
    rojoSynced: true,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  seedRestoreSuccess();
});

// ── restoreLatestFileCheckpoint ────────────────────────────────────────────

describe("useCheckpointHistory restoreLatestFileCheckpoint", () => {
  it("rewinds agent context via session.revert at the first message after the checkpoint prompt", async () => {
    desktopMock.checkpointList.mockResolvedValue([makeCheckpoint()]);
    const fakeClient = makeFakeClient();
    const qc = makeQC(["msg-prompt-1", "msg-asst-1", "msg-prompt-2", "msg-asst-2"]);

    const { result } = renderHook(() => useCheckpointHistory(SESSION_ID), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    let restoreResult: unknown;
    await act(async () => {
      restoreResult = await result.current.restoreLatestFileCheckpoint("msg-prompt-1");
    });

    expect(restoreResult).not.toBeNull();
    // The files were restored through the main process…
    expect(desktopMock.checkpointRestore).toHaveBeenCalledOnce();
    // …and the context rewind targets the first message AFTER the
    // checkpoint's prompt, keeping the prompt itself active.
    expect(fakeClient.session.revert).toHaveBeenCalledWith(
      { sessionID: SESSION_ID, messageID: "msg-asst-1" },
      expect.anything(),
    );
    // No visible message may ever be injected into the chat.
    expect(fakeClient.session.prompt).not.toHaveBeenCalled();
  });

  it("skips the context rewind when the checkpoint prompt is the last message", async () => {
    desktopMock.checkpointList.mockResolvedValue([makeCheckpoint()]);
    const fakeClient = makeFakeClient();
    const qc = makeQC(["msg-prompt-1"]);

    const { result } = renderHook(() => useCheckpointHistory(SESSION_ID), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await result.current.restoreLatestFileCheckpoint("msg-prompt-1");
    });

    expect(desktopMock.checkpointRestore).toHaveBeenCalledOnce();
    expect(fakeClient.session.revert).not.toHaveBeenCalled();
    expect(fakeClient.session.prompt).not.toHaveBeenCalled();
  });

  it("skips the context rewind for incremental checkpoints to protect preserved user edits", async () => {
    // Incremental restores deliberately keep post-checkpoint user edits;
    // session.revert would roll files back again and wipe them, so the
    // rewind is gated to full-snapshot checkpoints only.
    desktopMock.checkpointList.mockResolvedValue([makeCheckpoint({ fullSnapshot: false })]);
    const fakeClient = makeFakeClient();
    const qc = makeQC(["msg-prompt-1", "msg-asst-1"]);

    const { result } = renderHook(() => useCheckpointHistory(SESSION_ID), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    let restoreResult: unknown;
    await act(async () => {
      restoreResult = await result.current.restoreLatestFileCheckpoint("msg-prompt-1");
    });

    // Files are still restored…
    expect(restoreResult).not.toBeNull();
    expect(desktopMock.checkpointRestore).toHaveBeenCalledOnce();
    // …but the file-affecting context rewind stays off.
    expect(fakeClient.session.revert).not.toHaveBeenCalled();
    expect(fakeClient.session.prompt).not.toHaveBeenCalled();
  });

  it("still succeeds when the context rewind call fails", async () => {
    desktopMock.checkpointList.mockResolvedValue([makeCheckpoint()]);
    const fakeClient = makeFakeClient();
    fakeClient.session.revert.mockRejectedValue(new Error("revert rejected"));
    const qc = makeQC(["msg-prompt-1", "msg-asst-1"]);

    const { result } = renderHook(() => useCheckpointHistory(SESSION_ID), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    let restoreResult: unknown;
    await act(async () => {
      restoreResult = await result.current.restoreLatestFileCheckpoint("msg-prompt-1");
    });

    // The file restore result must survive a failed context rewind.
    expect(restoreResult).not.toBeNull();
    expect(desktopMock.checkpointRestore).toHaveBeenCalledOnce();
    expect(fakeClient.session.prompt).not.toHaveBeenCalled();
  });
});
