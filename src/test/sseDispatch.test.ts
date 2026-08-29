/**
 * Unit tests for sseDispatch — the SSE event → React Query cache mapper.
 *
 * These are pure logic tests: no React rendering, just a real QueryClient
 * and assertions on the cache state after dispatching events.
 */

import type {
  AssistantMessage,
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  TextPart,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import { QueryClient } from "@tanstack/react-query";
import { Cause, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/lib/queryKeys";
import {
  type MessagesCache,
  sseDispatch,
  sseDispatchEffect,
} from "@/lib/sseDispatch";
import {
  SILENT_CONTINUE_PROMPT,
  isSilentContinueMessage,
} from "@/lib/silentContinue";
import {
  makeAssistantMessage,
  makeTextPart,
  makeTodo,
  makeUserMessage,
} from "@/test/fixtures";

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
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

function dispatch(
  qc: QueryClient,
  event: Partial<Event>,
  activeSessionId: string | null = null,
) {
  sseDispatch(qc, event as Event, { current: activeSessionId });
}

// ── Typed cache accessors (fail loudly instead of non-null assertions) ──

function sessionsOf(qc: QueryClient): Session[] {
  const sessions = qc.getQueryData<Session[]>(qk.sessions);
  if (!sessions) throw new Error("expected sessions cache");
  return sessions;
}

function statusesOf(qc: QueryClient): Record<string, SessionStatus> {
  const statuses = qc.getQueryData<Record<string, SessionStatus>>(qk.statuses);
  if (!statuses) throw new Error("expected statuses cache");
  return statuses;
}

function messagesCacheOf(qc: QueryClient, sessionId = "s1"): MessagesCache {
  const cache = qc.getQueryData<MessagesCache>(qk.messages(sessionId));
  if (!cache) throw new Error(`expected messages cache for ${sessionId}`);
  return cache;
}

describe("sseDispatch", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQC();
  });

  // ── Guard clauses ──────────────────────────────────────────────────

  it("ignores null/undefined events", () => {
    dispatch(qc, null as never);
    dispatch(qc, undefined as never);
    // Should not throw
  });

  it("ignores events with no type", () => {
    dispatch(qc, { properties: {} } as never);
  });

  it("rejects an invalid SSE envelope in the typed error channel", () => {
    const result = Effect.runSync(
      Effect.either(
        sseDispatchEffect(
          qc,
          { type: "session.created", properties: null },
          { current: null },
        ),
      ),
    );

    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "SseDispatchError", eventType: "session.created" },
    });
  });

  it("keeps cache programming errors as defects", () => {
    const brokenClient = {
      setQueryData: () => {
        throw new Error("cache programming bug");
      },
    } as unknown as QueryClient;
    const exit = Effect.runSyncExit(
      sseDispatchEffect(
        brokenClient,
        {
          type: "session.created",
          properties: { info: makeSession("s1", "One") },
        },
        { current: null },
      ),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Cause.dieOption(exit.cause)).toMatchObject({
        _tag: "Some",
        value: expect.objectContaining({ message: "cache programming bug" }),
      });
    }
  });

  // ── Session events ─────────────────────────────────────────────────

  describe("session.created", () => {
    it("adds a new session to the sessions cache", () => {
      const existing = makeSession("s1", "One");
      qc.setQueryData(qk.sessions, [existing]);

      dispatch(qc, {
        type: "session.created",
        properties: { sessionID: "s2", info: makeSession("s2", "Two") },
      });

      const sessions = sessionsOf(qc);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("s2"); // prepended
    });

    it("does not duplicate an existing session", () => {
      const s1 = makeSession("s1", "One");
      qc.setQueryData(qk.sessions, [s1]);

      dispatch(qc, {
        type: "session.created",
        properties: { sessionID: "s1", info: s1 },
      });

      expect(qc.getQueryData<Session[]>(qk.sessions)).toHaveLength(1);
    });

    it("creates the array when cache is empty", () => {
      dispatch(qc, {
        type: "session.created",
        properties: { sessionID: "s1", info: makeSession("s1", "One") },
      });

      const sessions = sessionsOf(qc);
      expect(sessions).toHaveLength(1);
    });
  });

  describe("session.updated", () => {
    it("replaces the matching session in cache", () => {
      qc.setQueryData(qk.sessions, [makeSession("s1", "Old Title")]);

      dispatch(qc, {
        type: "session.updated",
        properties: { sessionID: "s1", info: makeSession("s1", "New Title") },
      });

      const sessions = sessionsOf(qc);
      expect(sessions[0].title).toBe("New Title");
    });

    it("leaves non-matching sessions untouched", () => {
      qc.setQueryData(qk.sessions, [
        makeSession("s1", "One"),
        makeSession("s2", "Two"),
      ]);

      dispatch(qc, {
        type: "session.updated",
        properties: { sessionID: "s1", info: makeSession("s1", "Updated") },
      });

      const sessions = sessionsOf(qc);
      expect(sessions[1].title).toBe("Two");
    });
  });

  describe("session.deleted", () => {
    it("removes the session from cache", () => {
      qc.setQueryData(qk.sessions, [
        makeSession("s1", "One"),
        makeSession("s2", "Two"),
      ]);
      qc.setQueryData(qk.statuses, {
        s1: { type: "idle" },
        s2: { type: "busy" },
      });
      qc.setQueryData(qk.messages("s1"), { messageIds: [], messagesById: {} });
      qc.setQueryData(qk.todos("s1"), []);

      dispatch(qc, {
        type: "session.deleted",
        properties: { sessionID: "s1", info: makeSession("s1", "One") },
      });

      const sessions = sessionsOf(qc);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("s2");
      expect(qc.getQueryData(qk.messages("s1"))).toBeUndefined();
      expect(qc.getQueryData(qk.todos("s1"))).toBeUndefined();
      expect(qc.getQueryData(qk.statuses)).toEqual({ s2: { type: "busy" } });
    });
  });

  // ── Session status events ──────────────────────────────────────────

  describe("session.status", () => {
    it("sets session status in the statuses cache", () => {
      qc.setQueryData(qk.statuses, {});

      dispatch(qc, {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      });

      const statuses = statusesOf(qc);
      expect(statuses.s1.type).toBe("busy");
    });

    it("keeps structured retry actions from OpenCode", () => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });

      dispatch(qc, {
        type: "session.status",
        properties: {
          sessionID: "s1",
          status: {
            type: "retry",
            attempt: 1,
            message: "Free usage exceeded, subscribe to Go",
            next: Date.now() + 60_000,
            action: {
              provider: "opencode",
              reason: "free_tier_limit",
              title: "Free limit reached",
              message: "Subscribe to OpenCode Go for reliable access.",
              label: "Subscribe",
              link: "https://opencode.ai/go",
            },
          },
        },
      });

      const status = qc.getQueryData<Record<string, SessionStatus>>(
        qk.statuses,
      )?.s1;
      expect(status).toMatchObject({
        type: "retry",
        action: { provider: "opencode", reason: "free_tier_limit" },
      });
    });
  });

  describe("session.idle", () => {
    it("sets session to idle", () => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });

      dispatch(qc, { type: "session.idle", properties: { sessionID: "s1" } });

      const statuses = statusesOf(qc);
      expect(statuses.s1.type).toBe("idle");
    });

    it("skips update when already idle", () => {
      const initial = { s1: { type: "idle" } as SessionStatus };
      qc.setQueryData(qk.statuses, initial);

      dispatch(qc, { type: "session.idle", properties: { sessionID: "s1" } });

      expect(qc.getQueryData(qk.statuses)).toBe(initial);
    });

    it("invalidates the active session's messages so dropped SyncEvent parts are restored", () => {
      // The engine (anomalyco/opencode >= 1.14.42) drops `message.part.updated`
      // from the `/event` SSE stream, so parts never arrive via SSE. The
      // persisted store stays authoritative, so idle must trigger a refetch.
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      qc.setQueryData(qk.messages("s1"), { messageIds: [], messagesById: {} });

      dispatch(
        qc,
        { type: "session.idle", properties: { sessionID: "s1" } },
        "s1",
      );

      expect(qc.getQueryState(qk.messages("s1"))?.isInvalidated).toBe(true);
    });

    it("does not invalidate messages for a non-active session", () => {
      qc.setQueryData(qk.statuses, { s2: { type: "busy" } as SessionStatus });
      qc.setQueryData(qk.messages("s2"), { messageIds: [], messagesById: {} });

      dispatch(
        qc,
        { type: "session.idle", properties: { sessionID: "s2" } },
        "s1",
      );

      expect(qc.getQueryState(qk.messages("s2"))?.isInvalidated).toBeFalsy();
    });
  });

  describe("session.error", () => {
    it("stops the busy state and stores the active session error", () => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
      const error = {
        name: "APIError" as const,
        data: {
          message: "Provider request failed",
          statusCode: 400,
          isRetryable: false,
        },
      };

      dispatch(
        qc,
        { type: "session.error", properties: { sessionID: "s1", error } },
        "s1",
      );

      expect(
        qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type,
      ).toBe("idle");
      expect(qc.getQueryData(qk.sessionError("s1"))).toEqual(error);
    });

    it("does not show another session's error in the active chat", () => {
      dispatch(
        qc,
        {
          type: "session.error",
          properties: {
            sessionID: "s2",
            error: { name: "UnknownError", data: { message: "failed" } },
          },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.sessionError("s1"))).toBeUndefined();
    });
  });

  describe("session.compacted", () => {
    it("invalidates active-session messages so the compacted history is refreshed", () => {
      qc.setQueryData(qk.messages("s1"), { messageIds: [], messagesById: {} });

      dispatch(
        qc,
        { type: "session.compacted", properties: { sessionID: "s1" } },
        "s1",
      );

      expect(qc.getQueryState(qk.messages("s1"))?.isInvalidated).toBe(true);
    });
  });

  // ── Message events ─────────────────────────────────────────────────

  describe("message.updated", () => {
    it("captures anonymous provider, model, and aggregate token usage once", () => {
      const captureModelUsage = vi.fn();
      const event = {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1, completed: 2 },
            parentID: "m0",
            providerID: "anthropic",
            modelID: "claude-sonnet-4",
            mode: "chat",
            agent: "build",
            path: { cwd: "/workspace", root: "/workspace" },
            cost: 0.01,
            tokens: {
              total: 21,
              input: 10,
              output: 7,
              reasoning: 4,
              cache: { read: 3, write: 2 },
            },
          },
        },
      };

      sseDispatch(qc, event, { current: "s1" }, captureModelUsage);
      sseDispatch(qc, event, { current: "s1" }, captureModelUsage);

      expect(captureModelUsage).toHaveBeenCalledOnce();
      expect(captureModelUsage).toHaveBeenCalledWith({
        provider: "anthropic",
        model: "claude-sonnet-4",
        tokens_total: 21,
        tokens_input: 10,
        tokens_output: 7,
        tokens_reasoning: 4,
        tokens_cache_read: 3,
        tokens_cache_write: 2,
      });
    });

    it("adds a new message to the cache", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: [],
        messagesById: {},
      });

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            sessionID: "s1",
            info: makeAssistantMessage({ id: "m1" }),
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m1"]);
      expect(cache.messagesById.m1.info.id).toBe("m1");
      expect(cache.messagesById.m1.parts).toEqual([]);
    });

    it("updates an existing message's info without losing parts", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [makeTextPart({ text: "hello" })],
          },
        },
      });

      const updatedInfo: AssistantMessage & { metadata: string } = {
        ...makeAssistantMessage({ id: "m1" }),
        metadata: "updated",
      };

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            sessionID: "s1",
            info: updatedInfo,
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m1"]); // not duplicated
      expect(cache.messagesById.m1.parts).toHaveLength(1); // parts preserved
      expect(cache.messagesById.m1.info).toHaveProperty("metadata", "updated");
    });

    it("ignores messages for a different session", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: [],
        messagesById: {},
      });

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            sessionID: "s2",
            info: makeAssistantMessage({ id: "m1", sessionID: "s2" }),
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual([]);
    });

    it("creates cache from scratch when prev is null", () => {
      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            sessionID: "s1",
            info: makeAssistantMessage({ id: "m1" }),
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m1"]);
    });
  });

  describe("message.part.updated", () => {
    it("appends a new part to an existing message", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: makeTextPart({ text: "hi" }),
            time: 0,
          },
        },
        "s1",
      );

      const msg = messagesCacheOf(qc).messagesById.m1;
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({ text: "hi" });
    });

    it("replaces an existing part by id", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [makeTextPart({ text: "old" })],
          },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: makeTextPart({ text: "new" }),
            time: 0,
          },
        },
        "s1",
      );

      const msg = messagesCacheOf(qc).messagesById.m1;
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({ text: "new" });
    });
  });

  describe("message.part.delta", () => {
    it("appends delta text to the correct part", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [makeTextPart({ text: "Hello" })],
          },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: {
            sessionID: "s1",
            messageID: "m1",
            partID: "p1",
            field: "",
            delta: " World",
          },
        },
        "s1",
      );

      const part = messagesCacheOf(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ text: "Hello World" });
    });

    it("uses field parameter when provided", () => {
      const partWithOutput: TextPart & { output: string } = {
        ...makeTextPart({ text: "base" }),
        output: "out",
      };
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [partWithOutput],
          },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: {
            sessionID: "s1",
            messageID: "m1",
            partID: "p1",
            field: "output",
            delta: "+more",
          },
        },
        "s1",
      );

      const part = messagesCacheOf(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ output: "out+more", text: "base" }); // text unchanged
    });

    it("ignores delta when part is not found", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: {
            sessionID: "s1",
            messageID: "m1",
            partID: "nonexistent",
            field: "text",
            delta: "x",
          },
        },
        "s1",
      );

      // Should not throw, cache unchanged
      expect(messagesCacheOf(qc).messagesById.m1.parts).toHaveLength(0);
    });
  });

  describe("message.removed", () => {
    it("removes a message from the cache", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1", "m2"],
        messagesById: {
          m1: { info: makeAssistantMessage({ id: "m1" }), parts: [] },
          m2: { info: makeAssistantMessage({ id: "m2" }), parts: [] },
        },
      });

      dispatch(
        qc,
        {
          type: "message.removed",
          properties: { sessionID: "s1", messageID: "m1" },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m2"]);
      expect(cache.messagesById.m1).toBeUndefined();
    });
  });

  describe("message.part.removed", () => {
    it("removes a part from a message", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [makeTextPart({ id: "p1" }), makeTextPart({ id: "p2" })],
          },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.removed",
          properties: { sessionID: "s1", messageID: "m1", partID: "p1" },
        },
        "s1",
      );

      const parts = messagesCacheOf(qc).messagesById.m1.parts;
      expect(parts).toHaveLength(1);
      expect(parts[0].id).toBe("p2");
    });
  });

  // ── Silent-continue purge ────────────────────────────────────────────

  describe("silent-continue message purge", () => {
    it("purges a silent-continue user message when its marker part arrives", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["a1", "m1"],
        messagesById: {
          a1: {
            info: makeUserMessage({ id: "a1" }),
            parts: [], // empty shell before the marker text part arrives
          },
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [makeTextPart({ id: "p1", text: "done" })],
          },
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.updated",
          properties: {
            sessionID: "s1",
            part: makeTextPart({
              id: "marker-p1",
              messageID: "a1", // must match the message in the cache
              text: SILENT_CONTINUE_PROMPT,
            }),
            time: 0,
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m1"]);
      expect(cache.messagesById.a1).toBeUndefined();
    });

    it("purges a silently-continuing user message as deltas complete its marker text", () => {
      const prefix = SILENT_CONTINUE_PROMPT.slice(0, 10); // "Continue g"
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["a1", "m1"],
        messagesById: {
          a1: {
            info: makeUserMessage({ id: "a1" }),
            parts: [makeTextPart({ id: "marker-p1", text: prefix })],
          },
          m1: {
            info: makeAssistantMessage({ id: "m1" }),
            parts: [],
          },
        },
      });

      // Sanity: the partial message is recognized as in-progress
      expect(isSilentContinueMessage(messagesCacheOf(qc).messagesById.a1)).toBe(
        false,
      );

      // Send deltas that complete the marker
      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: {
            sessionID: "s1",
            messageID: "a1",
            partID: "marker-p1",
            field: "text",
            delta: SILENT_CONTINUE_PROMPT.slice(prefix.length),
          },
        },
        "s1",
      );

      const cache = messagesCacheOf(qc);
      expect(cache.messageIds).toEqual(["m1"]);
      expect(cache.messagesById.a1).toBeUndefined();
    });
  });

  // ── Todo events ────────────────────────────────────────────────────

  describe("todo.updated", () => {
    it("replaces the todos cache for the active session", () => {
      qc.setQueryData(qk.todos("s1"), []);
      const newTodos = [makeTodo()];

      dispatch(
        qc,
        {
          type: "todo.updated",
          properties: { sessionID: "s1", todos: newTodos },
        },
        "s1",
      );

      expect(qc.getQueryData<Todo[]>(qk.todos("s1"))).toEqual(newTodos);
    });

    it("ignores todos for a different session", () => {
      qc.setQueryData(qk.todos("s1"), []);

      dispatch(
        qc,
        {
          type: "todo.updated",
          properties: { sessionID: "s2", todos: [makeTodo()] },
        },
        "s1",
      );

      expect(qc.getQueryData<Todo[]>(qk.todos("s1"))).toEqual([]);
    });
  });

  // ── Question events ────────────────────────────────────────────────

  describe("question.asked", () => {
    it("sets the active question", () => {
      dispatch(
        qc,
        {
          type: "question.asked",
          properties: { id: "q1", sessionID: "s1", questions: [] },
        },
        "s1",
      );

      const q = qc.getQueryData<QuestionRequest | null>(qk.questions("s1"));
      expect(q?.id).toBe("q1");
    });
  });

  describe("question.replied / question.rejected", () => {
    it("clears the question on reply", () => {
      qc.setQueryData(qk.questions("s1"), { id: "q1", sessionID: "s1" });

      dispatch(
        qc,
        {
          type: "question.replied",
          properties: { sessionID: "s1", requestID: "q1", answers: [] },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.questions("s1"))).toBeNull();
    });

    it("clears the question on reject", () => {
      qc.setQueryData(qk.questions("s1"), { id: "q1", sessionID: "s1" });

      dispatch(
        qc,
        {
          type: "question.rejected",
          properties: { sessionID: "s1", requestID: "q1" },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.questions("s1"))).toBeNull();
    });
  });

  // ── Permission events ──────────────────────────────────────────────

  describe("permission.asked", () => {
    it("sets the active permission request", () => {
      dispatch(
        qc,
        {
          type: "permission.asked",
          properties: {
            id: "p1",
            sessionID: "s1",
            permission: "bash",
            patterns: [],
            metadata: {},
            always: [],
          },
        },
        "s1",
      );

      const p = qc.getQueryData<PermissionRequest | null>(qk.permissions("s1"));
      expect(p?.id).toBe("p1");
    });
  });

  describe("permission.replied", () => {
    it("clears the permission request", () => {
      qc.setQueryData(qk.permissions("s1"), { id: "p1", sessionID: "s1" });

      dispatch(
        qc,
        {
          type: "permission.replied",
          properties: { sessionID: "s1", requestID: "p1", reply: "once" },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.permissions("s1"))).toBeNull();
    });
  });
});
