/**
 * Tests for the Regenerate response flow (useRegenerateResponse):
 * regenerating an assistant response must delete the old response AND its
 * anchor user prompt, then re-admit the identical prompt via promptAsync so
 * the agent generates a fresh answer from the retained history. Preceding
 * messages must never be touched.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRegenerateResponse } from "@/hooks/mutations/useRegenerateResponse";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesContext } from "@/providers/PreferencesProvider";
import { makeAssistantMessage, makeFilePart, makeTextPart, makeUserMessage } from "@/test/fixtures";
import type { MessageWithParts } from "@/types";

// ── Helpers ────────────────────────────────────────────────────────────────

const SESSION_ID = "s1";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

function makeFakeClient() {
  return {
    session: {
      deleteMessage: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      promptAsync: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
      // onSuccess invalidates the messages query, which refetches through
      // this endpoint — stub it so the background refetch never rejects.
      messages: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
}

function makeQC(entries: MessageWithParts[]) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const cache: MessagesCache = {
    messageIds: entries.map((e) => e.info.id),
    messagesById: Object.fromEntries(entries.map((e) => [e.info.id, e])),
  };
  qc.setQueryData(qk.messages(SESSION_ID), cache);
  return qc;
}

function makePreferences() {
  return {
    selectedModel: "anthropic/claude",
    selectedAgent: "build",
    selectedVariant: "medium",
  };
}

function makeWrapper(
  qc: QueryClient,
  fakeClient: ReturnType<typeof makeFakeClient>,
  preferences = makePreferences(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const ref = useRef<string | null>(SESSION_ID);
    return (
      <QueryClientProvider client={qc}>
        <ActiveSessionContext.Provider
          value={{
            activeSessionId: SESSION_ID,
            selectSession: async () => {},
            clearSession: () => {},
            activeSessionIdRef: ref,
          }}
        >
          <OpenCodeClientContext.Provider
            value={{
              client: fakeClient as unknown as OpencodeClient,
              status: "ready",
              port: 34999,
              ready: true,
              initError: null,
            }}
          >
            <PreferencesContext.Provider value={preferences as never}>
              {children}
            </PreferencesContext.Provider>
          </OpenCodeClientContext.Provider>
        </ActiveSessionContext.Provider>
      </QueryClientProvider>
    );
  };
}

function makeConversation() {
  const user1: MessageWithParts = {
    info: makeUserMessage({ id: "msg-user-1" }),
    parts: [makeTextPart({ id: "p-1", messageID: "msg-user-1", text: "first task" })],
  };
  const asst1: MessageWithParts = {
    info: makeAssistantMessage({ id: "msg-asst-1", parentID: "msg-user-1" }),
    parts: [makeTextPart({ id: "p-2", messageID: "msg-asst-1", text: "first answer" })],
  };
  const user2: MessageWithParts = {
    info: makeUserMessage({ id: "msg-user-2" }),
    parts: [
      makeTextPart({ id: "p-3", messageID: "msg-user-2", text: "second task" }),
      makeFilePart({ id: "p-4", messageID: "msg-user-2", filename: "shot.png" }),
    ],
  };
  const asst2: MessageWithParts = {
    info: makeAssistantMessage({ id: "msg-asst-2", parentID: "msg-user-2" }),
    parts: [makeTextPart({ id: "p-5", messageID: "msg-asst-2", text: "second answer" })],
  };
  return { user1, asst1, user2, asst2 };
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useRegenerateResponse ─────────────────────────────────────────────────

describe("useRegenerateResponse", () => {
  it("deletes the response and anchor prompt (newest-first), then re-sends the original prompt", async () => {
    const { user1, asst1, user2, asst2 } = makeConversation();
    const fakeClient = makeFakeClient();
    const qc = makeQC([user1, asst1, user2, asst2]);

    const { result } = renderHook(() => useRegenerateResponse(), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ assistantMessageId: "msg-asst-2" });
    });

    // Only the targeted response and its anchor prompt are deleted — the
    // preceding turn must stay untouched, newest-first.
    expect(fakeClient.session.deleteMessage).toHaveBeenCalledTimes(2);
    expect(fakeClient.session.deleteMessage.mock.calls.map((c) => c[0].messageID)).toEqual([
      "msg-asst-2",
      "msg-user-2",
    ]);
    // The original prompt (text + image attachment) is replayed with the
    // current model/agent/variant preferences.
    expect(fakeClient.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: SESSION_ID,
        parts: [
          { type: "text", text: "second task" },
          expect.objectContaining({ type: "file", url: "data:image/png;base64,test" }),
        ],
        model: { providerID: "anthropic", modelID: "claude" },
        agent: "build",
        variant: "medium",
      }),
      expect.anything(),
    );
  });

  it("fails without deleting anything when the response has no preceding user prompt", async () => {
    const { asst1 } = makeConversation();
    const fakeClient = makeFakeClient();
    const qc = makeQC([asst1]);

    const { result } = renderHook(() => useRegenerateResponse(), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ assistantMessageId: "msg-asst-1" }),
      ).rejects.toThrow("No user prompt found");
    });

    expect(fakeClient.session.deleteMessage).not.toHaveBeenCalled();
    expect(fakeClient.session.promptAsync).not.toHaveBeenCalled();
  });

  it("surfaces the error and restores the session status when the re-send fails", async () => {
    const { user2, asst2 } = makeConversation();
    const fakeClient = makeFakeClient();
    fakeClient.session.promptAsync.mockRejectedValue(new Error("model unavailable"));
    const qc = makeQC([user2, asst2]);

    const { result } = renderHook(() => useRegenerateResponse(), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ assistantMessageId: "msg-asst-2" }),
      ).rejects.toThrow("model unavailable");
    });

    // Optimistic busy status must be rolled back so the UI doesn't hang
    // (the entry is removed, leaving an empty status map).
    await waitFor(() => {
      expect(qc.getQueryData(qk.statuses)).toEqual({});
    });
  });
});
