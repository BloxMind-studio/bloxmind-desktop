/**
 * Unit tests for sseDispatch — the SSE event → React Query cache mapper.
 *
 * These are pure logic tests: no React rendering, just a real QueryClient
 * and assertions on the cache state after dispatching events.
 */

import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import { QueryClient } from "@tanstack/react-query";
import { Cause, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/lib/queryKeys";
import {
  flushSseDeltas,
  type MessagesCache,
  sseDispatch,
  sseDispatchEffect,
} from "@/lib/sseDispatch";
import type { MessageWithParts } from "@/types";

type MessageInfo = MessageWithParts["info"];
type MessagePart = MessageWithParts["parts"][number];

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function makeSession(id: string, title: string): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "C:/project",
    title,
    time: { created: Date.now(), updated: Date.now() },
    version: "1",
    parentID: "",
  } as Session;
}

// ── Cache fixtures ───────────────────────────────────────────────────
// The SSE handlers only read the fields a test cares about, so these
// helpers build the minimal shapes instead of hand-rolling casts in every
// test.

function messageInfo(id: string): MessageInfo {
  return { id, sessionID: "s1", role: "assistant" } as MessageInfo;
}

function textPart(id: string, text: string, extra?: { output?: string }): MessagePart {
  return {
    id,
    sessionID: "s1",
    messageID: "m1",
    type: "text",
    text,
    ...extra,
  } as MessagePart;
}

function message(id: string, parts: MessagePart[] = []): MessageWithParts {
  return { info: messageInfo(id), parts };
}

function getMessages(qc: QueryClient, sessionID = "s1"): MessagesCache {
  const cache = qc.getQueryData<MessagesCache>(qk.messages(sessionID));
  if (!cache) throw new Error(`no messages cache for ${sessionID}`);
  return cache;
}

function getSessions(qc: QueryClient): Session[] {
  const sessions = qc.getQueryData<Session[]>(qk.sessions);
  if (!sessions) throw new Error("no sessions cache");
  return sessions;
}

function getStatuses(qc: QueryClient): Record<string, SessionStatus> {
  const statuses = qc.getQueryData<Record<string, SessionStatus>>(qk.statuses);
  if (!statuses) throw new Error("no statuses cache");
  return statuses;
}

function dispatch(qc: QueryClient, event: unknown, activeSessionId: string | null = null) {
  sseDispatch(qc, event as Event, { current: activeSessionId });
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
        sseDispatchEffect(qc, { type: "session.created", properties: null }, { current: null }),
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
        { type: "session.created", properties: { info: makeSession("s1", "One") } },
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
        properties: { info: makeSession("s2", "Two") },
      });

      const sessions = getSessions(qc);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("s2"); // prepended
    });

    it("does not duplicate an existing session", () => {
      const s1 = makeSession("s1", "One");
      qc.setQueryData(qk.sessions, [s1]);

      dispatch(qc, { type: "session.created", properties: { info: s1 } });

      expect(qc.getQueryData<Session[]>(qk.sessions)).toHaveLength(1);
    });

    it("creates the array when cache is empty", () => {
      dispatch(qc, {
        type: "session.created",
        properties: { info: makeSession("s1", "One") },
      });

      const sessions = getSessions(qc);
      expect(sessions).toHaveLength(1);
    });
  });

  describe("session.updated", () => {
    it("replaces the matching session in cache", () => {
      qc.setQueryData(qk.sessions, [makeSession("s1", "Old Title")]);

      dispatch(qc, {
        type: "session.updated",
        properties: { info: makeSession("s1", "New Title") },
      });

      const sessions = getSessions(qc);
      expect(sessions[0].title).toBe("New Title");
    });

    it("leaves non-matching sessions untouched", () => {
      qc.setQueryData(qk.sessions, [makeSession("s1", "One"), makeSession("s2", "Two")]);

      dispatch(qc, {
        type: "session.updated",
        properties: { info: makeSession("s1", "Updated") },
      });

      const sessions = getSessions(qc);
      expect(sessions[1].title).toBe("Two");
    });
  });

  describe("session.deleted", () => {
    it("removes the session from cache", () => {
      qc.setQueryData(qk.sessions, [makeSession("s1", "One"), makeSession("s2", "Two")]);
      qc.setQueryData(qk.statuses, { s1: { type: "idle" }, s2: { type: "busy" } });
      qc.setQueryData(qk.messages("s1"), { messageIds: [], messagesById: {} });
      qc.setQueryData(qk.todos("s1"), []);

      dispatch(qc, {
        type: "session.deleted",
        properties: { info: makeSession("s1", "One") },
      });

      const sessions = getSessions(qc);
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

      const statuses = getStatuses(qc);
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

      const status = qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1;
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

      const statuses = getStatuses(qc);
      expect(statuses.s1.type).toBe("idle");
    });

    it("skips update when already idle", () => {
      const initial = { s1: { type: "idle" } as SessionStatus };
      qc.setQueryData(qk.statuses, initial);

      dispatch(qc, { type: "session.idle", properties: { sessionID: "s1" } });

      expect(qc.getQueryData(qk.statuses)).toBe(initial);
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

      dispatch(qc, { type: "session.error", properties: { sessionID: "s1", error } }, "s1");

      expect(qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type).toBe("idle");
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

      dispatch(qc, { type: "session.compacted", properties: { sessionID: "s1" } }, "s1");

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
      qc.setQueryData<MessagesCache>(qk.messages("s1"), { messageIds: [], messagesById: {} });

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            info: { id: "m1", sessionID: "s1", role: "assistant" },
          },
        },
        "s1",
      );

      const cache = getMessages(qc);
      expect(cache.messageIds).toEqual(["m1"]);
      expect(cache.messagesById.m1.info.id).toBe("m1");
      expect(cache.messagesById.m1.parts).toEqual([]);
    });

    it("updates an existing message's info without losing parts", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "hello")]),
        },
      });

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: {
            info: { id: "m1", sessionID: "s1", role: "assistant", metadata: "updated" },
          },
        },
        "s1",
      );

      const cache = getMessages(qc);
      expect(cache.messageIds).toEqual(["m1"]); // not duplicated
      expect(cache.messagesById.m1.parts).toHaveLength(1); // parts preserved
      expect(cache.messagesById.m1.info).toMatchObject({ metadata: "updated" });
    });

    it("ignores messages for a different session", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), { messageIds: [], messagesById: {} });

      dispatch(
        qc,
        {
          type: "message.updated",
          properties: { info: { id: "m1", sessionID: "s2" } },
        },
        "s1",
      );

      const cache = getMessages(qc);
      expect(cache.messageIds).toEqual([]);
    });

    it("creates cache from scratch when prev is null", () => {
      dispatch(
        qc,
        {
          type: "message.updated",
          properties: { info: { id: "m1", sessionID: "s1" } },
        },
        "s1",
      );

      const cache = getMessages(qc);
      expect(cache.messageIds).toEqual(["m1"]);
    });
  });

  describe("message.part.updated", () => {
    it("appends a new part to an existing message", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: { m1: message("m1") },
      });

      dispatch(
        qc,
        {
          type: "message.part.updated",
          properties: {
            part: { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "hi" },
          },
        },
        "s1",
      );

      const msg = getMessages(qc).messagesById.m1;
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({ text: "hi" });
    });

    it("replaces an existing part by id", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "old")]),
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.updated",
          properties: {
            part: { id: "p1", messageID: "m1", sessionID: "s1", type: "text", text: "new" },
          },
        },
        "s1",
      );

      const msg = getMessages(qc).messagesById.m1;
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({ text: "new" });
    });
  });

  describe("message.part.delta", () => {
    it("appends delta text to the correct part", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "Hello")]),
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "p1", delta: " World" },
        },
        "s1",
      );
      flushSseDeltas();

      const part = getMessages(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ text: "Hello World" });
    });

    it("uses field parameter when provided", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "base", { output: "out" })]),
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
      flushSseDeltas();

      const part = getMessages(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ output: "out+more", text: "base" });
    });

    it("coalesces a burst of deltas into one cache write", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "")]),
        },
      });
      const setQueryData = vi.spyOn(qc, "setQueryData");

      for (const delta of ["Hello", " ", "World", "!"]) {
        dispatch(
          qc,
          {
            type: "message.part.delta",
            properties: { sessionID: "s1", messageID: "m1", partID: "p1", delta },
          },
          "s1",
        );
      }
      expect(setQueryData).not.toHaveBeenCalled();

      flushSseDeltas();

      expect(setQueryData).toHaveBeenCalledTimes(1);
      const part = getMessages(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ text: "Hello World!" });
    });

    it("ignores deltas addressed to another session", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", "Hello")]),
        },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: { sessionID: "s2", messageID: "m1", partID: "p1", delta: " World" },
        },
        "s1",
      );
      flushSseDeltas();

      const part = getMessages(qc).messagesById.m1.parts[0];
      expect(part).toMatchObject({ text: "Hello" });
    });

    it("ignores delta when part is not found", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: { m1: message("m1") },
      });

      dispatch(
        qc,
        {
          type: "message.part.delta",
          properties: { sessionID: "s1", messageID: "m1", partID: "nonexistent", delta: "x" },
        },
        "s1",
      );
      flushSseDeltas();

      // Should not throw, cache unchanged
      expect(getMessages(qc).messagesById.m1.parts).toHaveLength(0);
    });
  });

  describe("message.removed", () => {
    it("removes a message from the cache", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1", "m2"],
        messagesById: {
          m1: message("m1"),
          m2: message("m2"),
        },
      });

      dispatch(
        qc,
        { type: "message.removed", properties: { sessionID: "s1", messageID: "m1" } },
        "s1",
      );

      const cache = getMessages(qc);
      expect(cache.messageIds).toEqual(["m2"]);
      expect(cache.messagesById.m1).toBeUndefined();
    });
  });

  describe("message.part.removed", () => {
    it("removes a part from a message", () => {
      qc.setQueryData<MessagesCache>(qk.messages("s1"), {
        messageIds: ["m1"],
        messagesById: {
          m1: message("m1", [textPart("p1", ""), textPart("p2", "")]),
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

      const parts = getMessages(qc).messagesById.m1.parts;
      expect(parts).toHaveLength(1);
      expect(parts[0].id).toBe("p2");
    });
  });

  // ── Todo events ────────────────────────────────────────────────────

  describe("todo.updated", () => {
    it("replaces the todos cache for the active session", () => {
      qc.setQueryData(qk.todos("s1"), []);
      const newTodos = [{ id: "t1", content: "Do something" }] as unknown as Todo[];

      dispatch(
        qc,
        { type: "todo.updated", properties: { sessionID: "s1", todos: newTodos } },
        "s1",
      );

      expect(qc.getQueryData<Todo[]>(qk.todos("s1"))).toEqual(newTodos);
    });

    it("ignores todos for a different session", () => {
      qc.setQueryData(qk.todos("s1"), []);

      dispatch(
        qc,
        { type: "todo.updated", properties: { sessionID: "s2", todos: [{ id: "t1" }] } },
        "s1",
      );

      expect(qc.getQueryData<Todo[]>(qk.todos("s1"))).toEqual([]);
    });
  });

  // ── Question events ────────────────────────────────────────────────

  describe("question.asked", () => {
    it("adds the question to the queue", () => {
      dispatch(
        qc,
        {
          type: "question.asked",
          properties: { id: "q1", sessionID: "s1", questions: [] },
        },
        "s1",
      );

      const queue = qc.getQueryData<QuestionRequest[]>(qk.questions("s1"));
      expect(queue?.map((question) => question.id)).toEqual(["q1"]);
    });

    it("keeps the earlier question when another arrives", () => {
      for (const id of ["q1", "q2"]) {
        dispatch(
          qc,
          { type: "question.asked", properties: { id, sessionID: "s1", questions: [] } },
          "s1",
        );
      }

      const queue = qc.getQueryData<QuestionRequest[]>(qk.questions("s1"));
      expect(queue?.map((question) => question.id)).toEqual(["q1", "q2"]);
    });

    it("does not duplicate a repeated event", () => {
      const event = {
        type: "question.asked" as const,
        properties: { id: "q1", sessionID: "s1", questions: [] },
      };
      dispatch(qc, event, "s1");
      dispatch(qc, event, "s1");

      expect(qc.getQueryData<QuestionRequest[]>(qk.questions("s1"))).toHaveLength(1);
    });
  });

  describe("question.replied / question.rejected", () => {
    it("removes only the answered question", () => {
      qc.setQueryData<QuestionRequest[]>(qk.questions("s1"), [
        { id: "q1", sessionID: "s1" } as QuestionRequest,
        { id: "q2", sessionID: "s1" } as QuestionRequest,
      ]);

      dispatch(
        qc,
        { type: "question.replied", properties: { sessionID: "s1", requestID: "q1" } },
        "s1",
      );

      const queue = qc.getQueryData<QuestionRequest[]>(qk.questions("s1"));
      expect(queue?.map((question) => question.id)).toEqual(["q2"]);
    });

    it("removes the rejected question", () => {
      qc.setQueryData<QuestionRequest[]>(qk.questions("s1"), [
        { id: "q1", sessionID: "s1" } as QuestionRequest,
      ]);

      dispatch(
        qc,
        { type: "question.rejected", properties: { sessionID: "s1", requestID: "q1" } },
        "s1",
      );

      expect(qc.getQueryData<QuestionRequest[]>(qk.questions("s1"))).toEqual([]);
    });
  });

  // ── Permission events ──────────────────────────────────────────────

  describe("permission.asked", () => {
    it("queues the permission request", () => {
      dispatch(
        qc,
        {
          type: "permission.asked",
          properties: { id: "p1", sessionID: "s1", permission: "bash", patterns: [] },
        },
        "s1",
      );

      const queue = qc.getQueryData<PermissionRequest[]>(qk.permissions("s1"));
      expect(queue?.map((permission) => permission.id)).toEqual(["p1"]);
    });

    it("keeps the earlier request when a second one arrives", () => {
      for (const id of ["p1", "p2"]) {
        dispatch(
          qc,
          {
            type: "permission.asked",
            properties: { id, sessionID: "s1", permission: "bash", patterns: [] },
          },
          "s1",
        );
      }

      const queue = qc.getQueryData<PermissionRequest[]>(qk.permissions("s1"));
      expect(queue?.map((permission) => permission.id)).toEqual(["p1", "p2"]);
    });
  });

  describe("permission.replied", () => {
    it("removes only the answered request", () => {
      qc.setQueryData<PermissionRequest[]>(qk.permissions("s1"), [
        { id: "p1", sessionID: "s1" } as PermissionRequest,
        { id: "p2", sessionID: "s1" } as PermissionRequest,
      ]);

      dispatch(
        qc,
        { type: "permission.replied", properties: { sessionID: "s1", requestID: "p1" } },
        "s1",
      );

      const queue = qc.getQueryData<PermissionRequest[]>(qk.permissions("s1"));
      expect(queue?.map((permission) => permission.id)).toEqual(["p2"]);
    });
  });

  // ── Compaction events ──────────────────────────────────────────────

  describe("session.next.compaction.*", () => {
    it("marks the session as compacting when compaction starts", () => {
      dispatch(
        qc,
        {
          type: "session.next.compaction.started",
          properties: { timestamp: 1, sessionID: "s1", messageID: "m1", reason: "auto" },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.compaction("s1"))).toEqual({ active: true, reason: "auto" });
    });

    it("keeps the manual reason through the end event", () => {
      qc.setQueryData(qk.compaction("s1"), { active: true, reason: "manual" });

      dispatch(
        qc,
        {
          type: "session.next.compaction.ended",
          properties: {
            timestamp: 2,
            sessionID: "s1",
            messageID: "m1",
            reason: "manual",
            text: "summary",
            recent: "",
          },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.compaction("s1"))).toEqual({ active: false, reason: "manual" });
    });

    it("shows compaction when a delta arrives before started", () => {
      dispatch(
        qc,
        {
          type: "session.next.compaction.delta",
          properties: { timestamp: 1, sessionID: "s1", messageID: "m1", text: "sum" },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.compaction("s1"))).toEqual({ active: true, reason: "auto" });
    });

    it("clears the status when the session reports compacted", () => {
      qc.setQueryData(qk.compaction("s1"), { active: true, reason: "auto" });

      dispatch(qc, { type: "session.compacted", properties: { sessionID: "s1" } }, "s1");

      expect(qc.getQueryData(qk.compaction("s1"))).toEqual({ active: false, reason: "auto" });
    });

    it("keeps sessions independent", () => {
      dispatch(
        qc,
        {
          type: "session.next.compaction.started",
          properties: { timestamp: 1, sessionID: "s2", messageID: "m1", reason: "auto" },
        },
        "s1",
      );

      expect(qc.getQueryData(qk.compaction("s1"))).toBeUndefined();
      expect(qc.getQueryData(qk.compaction("s2"))).toEqual({ active: true, reason: "auto" });
    });
  });
});
