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
import { ModelPreferencesContext } from "@/providers/PreferencesProvider";
import { makeAssistantMessage, makeFilePart, makeTextPart, makeUserMessage } from "@/test/fixtures";
import type { MessageWithParts } from "@/types";

// ── Helpers ────────────────────────────────────────────────────────────────

const SESSION_ID = "s1";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Spies for the system-context hooks so individual tests can opt into a
// Studio target / project index context (both hooks degrade to null when
// their providers are absent, which is the default in these tests).
const providerSpies = vi.hoisted(() => ({
  useStudioTargetOptional: vi.fn((): { promptReference: string } | null => null),
  useProjectIndexContext: vi.fn((): { contextPrompt: string | null } => ({ contextPrompt: null })),
}));

vi.mock("@/providers/StudioTargetProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/StudioTargetProvider")>();
  return { ...actual, useStudioTargetOptional: providerSpies.useStudioTargetOptional };
});

vi.mock("@/providers/ProjectIndexProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/ProjectIndexProvider")>();
  return { ...actual, useProjectIndexContext: providerSpies.useProjectIndexContext };
});

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
            <ModelPreferencesContext.Provider value={preferences as never}>
              {children}
            </ModelPreferencesContext.Provider>
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
  providerSpies.useStudioTargetOptional.mockReturnValue(null);
  providerSpies.useProjectIndexContext.mockReturnValue({ contextPrompt: null });
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

  it("attaches the same system context a fresh send would use", async () => {
    providerSpies.useStudioTargetOptional.mockReturnValue({ promptReference: "TARGET: place1" });
    providerSpies.useProjectIndexContext.mockReturnValue({ contextPrompt: "PROJECT INDEX" });
    const { user2, asst2 } = makeConversation();
    const fakeClient = makeFakeClient();
    const qc = makeQC([user2, asst2]);

    const { result } = renderHook(() => useRegenerateResponse(), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ assistantMessageId: "msg-asst-2" });
    });

    expect(fakeClient.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ system: "TARGET: place1\n\nPROJECT INDEX" }),
      expect.anything(),
    );
  });

  it("skips a legacy injected system-notification message when finding the anchor prompt", async () => {
    const { user1, asst1 } = makeConversation();
    const injected: MessageWithParts = {
      info: makeUserMessage({ id: "msg-injected" }),
      parts: [
        makeTextPart({
          id: "p-inj",
          messageID: "msg-injected",
          text: "[SYSTEM_NOTIFICATION_RESTORE] back to checkpoint",
        }),
      ],
    };
    // asst2 follows the injected notification; the walk must skip it and
    // anchor on user1 instead.
    const asst2: MessageWithParts = {
      info: makeAssistantMessage({ id: "msg-asst-2", parentID: "msg-injected" }),
      parts: [makeTextPart({ id: "p-5", messageID: "msg-asst-2", text: "answer" })],
    };
    const fakeClient = makeFakeClient();
    const qc = makeQC([user1, asst1, injected, asst2]);

    const { result } = renderHook(() => useRegenerateResponse(), {
      wrapper: makeWrapper(qc, fakeClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ assistantMessageId: "msg-asst-2" });
    });

    // The truncation starts at the anchor (user1): everything from it
    // onward is deleted newest-first, including the skipped notification
    // and the messages in between. user1 itself is re-admitted verbatim.
    expect(fakeClient.session.deleteMessage.mock.calls.map((c) => c[0].messageID)).toEqual([
      "msg-asst-2",
      "msg-injected",
      "msg-asst-1",
      "msg-user-1",
    ]);
    // The replayed prompt is user1's text, never the notification text.
    expect(fakeClient.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ type: "text", text: "first task" }],
      }),
      expect.anything(),
    );
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
