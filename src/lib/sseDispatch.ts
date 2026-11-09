import type { QueryClient } from "@tanstack/react-query";
import { Data, Effect, Schema } from "effect";
import type { ModelError } from "@/lib/modelError";
import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@/lib/opencode";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import type { MessageWithParts } from "@/types";

export interface MessagesCache {
  messageIds: string[];
  messagesById: Record<string, MessageWithParts>;
}

/**
 * Whether the engine is currently summarizing a session. `reason` separates
 * automatic compaction (context window full) from the manual Compact button so
 * the chat can explain why the conversation is being rewritten.
 */
export interface CompactionState {
  active: boolean;
  reason: "auto" | "manual";
}

export interface ModelUsageEvent {
  provider: string;
  model: string;
  tokens_total: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
}

export class SseDispatchError extends Data.TaggedError("SseDispatchError")<{
  eventType: string;
  cause: unknown;
}> {}

const MESSAGES_REFETCH_DEBOUNCE_MS = 750;

/**
 * Deltas arrive many times per second. Appending each one straight into the
 * cache copies every message in the session and re-renders the chat for every
 * token, so they are accumulated and applied once per animation frame (or
 * every 100 ms while the window is hidden and frames are throttled).
 */
interface PendingDelta {
  sessionID: string;
  messageID: string;
  partID: string;
  field: string;
  text: string;
}

const pendingDeltas = new Map<QueryClient, Map<string, PendingDelta>>();
let pendingFlushFrame: number | null = null;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledFlush(): void {
  if (pendingFlushFrame !== null) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(pendingFlushFrame);
    pendingFlushFrame = null;
  }
  if (pendingFlushTimer !== null) {
    clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
}

/** Apply every queued delta now. Also used when another event could reorder the cache. */
export function flushSseDeltas(): void {
  cancelScheduledFlush();
  if (pendingDeltas.size === 0) return;

  const batch = new Map(pendingDeltas);
  pendingDeltas.clear();

  for (const [queryClient, entries] of batch) {
    // One cache write per session; within it, one object copy per message.
    const bySession = new Map<string, PendingDelta[]>();
    for (const entry of entries.values()) {
      const list = bySession.get(entry.sessionID);
      if (list) list.push(entry);
      else bySession.set(entry.sessionID, [entry]);
    }

    for (const [sessionID, updates] of bySession) {
      queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
        if (!prev) return prev;
        const messagesById = { ...prev.messagesById };
        let changed = false;

        const byMessage = new Map<string, PendingDelta[]>();
        for (const update of updates) {
          const list = byMessage.get(update.messageID);
          if (list) list.push(update);
          else byMessage.set(update.messageID, [update]);
        }

        for (const [messageID, messageUpdates] of byMessage) {
          const msg = messagesById[messageID];
          if (!msg) continue;
          const parts = [...msg.parts];
          let messageChanged = false;
          for (const update of messageUpdates) {
            const index = parts.findIndex((part) => part.id === update.partID);
            if (index < 0) continue;
            const part = { ...parts[index] } as Record<string, unknown>;
            if (typeof part[update.field] !== "string") continue;
            part[update.field] = (part[update.field] as string) + update.text;
            parts[index] = part as (typeof parts)[number];
            messageChanged = true;
          }
          if (messageChanged) {
            messagesById[messageID] = { ...msg, parts };
            changed = true;
          }
        }

        return changed ? { ...prev, messagesById } : prev;
      });
    }
  }
}

function scheduleSseFlush(): void {
  if (pendingFlushFrame === null && typeof requestAnimationFrame === "function") {
    pendingFlushFrame = requestAnimationFrame(() => {
      pendingFlushFrame = null;
      flushSseDeltas();
    });
  }
  if (pendingFlushTimer === null) {
    pendingFlushTimer = setTimeout(() => {
      pendingFlushTimer = null;
      flushSseDeltas();
    }, 100);
  }
}

function queueDelta(
  queryClient: QueryClient,
  delta: Omit<PendingDelta, "text">,
  text: string,
): void {
  let entries = pendingDeltas.get(queryClient);
  if (!entries) {
    entries = new Map();
    pendingDeltas.set(queryClient, entries);
  }
  const key = [delta.sessionID, delta.messageID, delta.partID, delta.field].join("\0");
  const existing = entries.get(key);
  if (existing) existing.text += text;
  else entries.set(key, { ...delta, text });
  scheduleSseFlush();
}

/**
 * Event deltas can outrun the message cache (for example when this window
 * opened mid-stream). Refetching on every miss would thrash the server, so
 * misses coalesce into one debounced invalidate per session.
 */
const pendingMessagesRefetches = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleMessagesRefetch(queryClient: QueryClient, sessionID: string): void {
  const existing = pendingMessagesRefetches.get(sessionID);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingMessagesRefetches.delete(sessionID);
    void queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) });
  }, MESSAGES_REFETCH_DEBOUNCE_MS);
  pendingMessagesRefetches.set(sessionID, timer);
}

// OC2 (v2.2.6) emits { type, data, ... } (V2Event). OC1 emitted { type, properties }.
// Accept both so staged migration keeps existing behavior and tolerates OC2 envelopes.
const SseEventEnvelopeSchema = Schema.Struct({
  type: Schema.String,
  properties: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  data: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}).pipe(
  Schema.filter((e) => e.properties !== undefined || e.data !== undefined, {
    message: () => "event must include properties or data",
  }),
);

/**
 * Maps an SSE Event to query cache updates.
 * `activeSessionIdRef` is a ref so we can read it without restarting the SSE loop.
 */
export function sseDispatch(
  queryClient: QueryClient,
  event: unknown,
  activeSessionIdRef: { current: string | null },
  captureModelUsage?: (usage: ModelUsageEvent) => void,
): void {
  Effect.runSync(
    sseDispatchEffect(queryClient, event, activeSessionIdRef, captureModelUsage).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning(`sseDispatch: malformed ${error.eventType} event, skipping`, error.cause),
      ),
    ),
  );
}

export function sseDispatchEffect(
  queryClient: QueryClient,
  event: unknown,
  activeSessionIdRef: { current: string | null },
  captureModelUsage?: (usage: ModelUsageEvent) => void,
): Effect.Effect<void, SseDispatchError> {
  if (!event || typeof event !== "object" || !("type" in event)) return Effect.void;

  return Schema.decodeUnknown(SseEventEnvelopeSchema)(event).pipe(
    Effect.mapError(
      (cause) =>
        new SseDispatchError({
          eventType: "type" in event && typeof event.type === "string" ? event.type : "unknown",
          cause,
        }),
    ),
    Effect.flatMap((envelope) =>
      Effect.sync(() =>
        dispatchEvent(
          queryClient,
          envelope as unknown as Event,
          activeSessionIdRef,
          captureModelUsage,
        ),
      ),
    ),
  );
}

function eventData(event: unknown): Record<string, unknown> {
  const e = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const data = e.data ?? e.properties;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function asSessionInfo(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return null;
  // OC1 Session has `time.created`; OC2 SessionInfo may differ. Accept if it looks session-like.
  return value as Session;
}

function normalizePermissionRequest(data: Record<string, unknown>): PermissionRequest {
  // OC1: {id, sessionID, permission, patterns, metadata, tool?}. OC2 permission.asked data:
  // {id, sessionID, action, resources, save?, metadata?, source?, message?}
  return {
    ...data,
    id: data.id,
    sessionID: data.sessionID,
    permission: data.permission ?? data.action ?? "unknown",
    patterns: data.patterns ?? data.resources ?? [],
    metadata: data.metadata ?? {},
  } as PermissionRequest;
}

function normalizeExecutionError(data: unknown): ModelError | null {
  const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  const err = dataObj?.error ?? data;
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  if (typeof e.name === "string" && "data" in e) return err as ModelError;
  // OC2 SessionStructuredError: {type, message, status?, response?:{body}, retryAfterMs?}
  const type = typeof e.type === "string" ? e.type : "UnknownError";
  const message = typeof e.message === "string" ? e.message : "The model could not respond.";
  const response =
    e.response && typeof e.response === "object"
      ? (e.response as Record<string, unknown>)
      : undefined;
  return {
    name: type,
    data: {
      message,
      responseBody: response?.body,
      statusCode: e.status,
      isRetryable: false,
    },
  } as unknown as ModelError;
}

function captureUsageFromTokens(
  captureModelUsage: ((usage: ModelUsageEvent) => void) | undefined,
  tokens: unknown,
  provider = "",
  model = "",
) {
  if (!captureModelUsage || !tokens || typeof tokens !== "object") return;
  const t = tokens as Record<string, unknown>;
  const cache =
    t.cache && typeof t.cache === "object" ? (t.cache as Record<string, unknown>) : undefined;
  const input = Number(t.input ?? 0);
  const output = Number(t.output ?? 0);
  const reasoning = Number(t.reasoning ?? 0);
  captureModelUsage({
    provider,
    model,
    tokens_total: Number(t.total ?? input + output + reasoning),
    tokens_input: input,
    tokens_output: output,
    tokens_reasoning: reasoning,
    tokens_cache_read: Number(cache?.read ?? t.cache_read ?? 0),
    tokens_cache_write: Number(cache?.write ?? t.cache_write ?? 0),
  });
}

function dispatchEvent(
  queryClient: QueryClient,
  event: unknown,
  activeSessionIdRef: { current: string | null },
  captureModelUsage?: (usage: ModelUsageEvent) => void,
): void {
  const currentSessionId = activeSessionIdRef.current;
  const data = eventData(event);
  const eventObj = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const type = String(eventObj.type ?? "");

  // Anything that rewrites a part, or a message, must land after the text
  // already streamed into the cache.
  if (
    type !== "message.part.delta" &&
    type !== "session.text.delta" &&
    type !== "session.reasoning.delta" &&
    type !== "session.compaction.delta"
  ) {
    flushSseDeltas();
  }

  switch (type) {
    case "session.created": {
      const info = asSessionInfo(data.info ?? data.session ?? data);
      if (info && isVisibleSession(info)) {
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return [info];
          if (prev.some((s) => s.id === info.id)) return prev;
          return [info, ...prev];
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: qk.sessions });
      }
      break;
    }
    case "session.updated": {
      const info = asSessionInfo(data.info ?? data);
      if (info) {
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return prev;
          return prev.map((s) => (s.id === info.id ? info : s));
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: qk.sessions });
      }
      break;
    }
    case "session.renamed":
    case "session.archived":
    case "session.unarchived":
    case "session.metadata.updated":
    case "session.agent.selected":
    case "session.model.selected": {
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
      const sid = data.sessionID ?? data.info?.id;
      if (sid) void queryClient.invalidateQueries({ queryKey: qk.session(sid) });
      break;
    }
    case "session.deleted": {
      const id = data.info?.id ?? data.sessionID ?? data.id;
      if (!id) break;
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== id);
      });
      queryClient.removeQueries({ queryKey: qk.session(id) });
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        if (!prev?.[id]) return prev;
        const { [id]: _deleted, ...remaining } = prev;
        return remaining;
      });
      break;
    }
    case "session.status": {
      const sessionID = data.sessionID;
      const status = data.status;
      if (!sessionID || !status) break;
      if (status.type !== "idle") {
        queryClient.setQueryData<ModelError | null>(qk.sessionError(sessionID), null);
      }
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        return { ...prev, [sessionID]: status };
      });
      break;
    }
    case "session.compacted": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      queryClient.setQueryData<CompactionState | null>(qk.compaction(sessionID), (prev) =>
        prev ? { ...prev, active: false } : prev,
      );
      if (sessionID === currentSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) });
      }
      break;
    }
    case "session.next.compaction.started":
    case "session.compaction.started": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      const reason = data.reason === "manual" ? "manual" : "auto";
      queryClient.setQueryData<CompactionState>(qk.compaction(sessionID), {
        active: true,
        reason,
      });
      break;
    }
    case "session.next.compaction.delta":
    case "session.compaction.delta": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      queryClient.setQueryData<CompactionState>(qk.compaction(sessionID), (prev) =>
        prev?.active ? prev : { active: true, reason: "auto" },
      );
      break;
    }
    case "session.next.compaction.ended":
    case "session.compaction.ended": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      const reason = data.reason === "manual" ? "manual" : "auto";
      queryClient.setQueryData<CompactionState>(qk.compaction(sessionID), {
        active: false,
        reason,
      });
      if (sessionID === currentSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) });
      }
      break;
    }
    case "session.compaction.failed": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      queryClient.setQueryData<CompactionState | null>(qk.compaction(sessionID), (prev) =>
        prev ? { ...prev, active: false } : prev,
      );
      break;
    }
    case "session.error":
    case "session.execution.failed":
    case "session.execution.interrupted": {
      const sessionID = data.sessionID ?? currentSessionId;
      if (!sessionID) break;

      queryClient.setQueryData<CompactionState | null>(qk.compaction(sessionID), (prev) =>
        prev ? { ...prev, active: false } : prev,
      );
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => ({
        ...prev,
        [sessionID]: { type: "idle" } as SessionStatus,
      }));
      if (type === "session.execution.interrupted") break;
      const error = data.error ?? (type === "session.error" ? data.error : undefined);
      const name = error?.name ?? error?.type;
      if (
        sessionID === currentSessionId &&
        error &&
        name !== "MessageAbortedError" &&
        data.reason !== "user"
      ) {
        const normalized =
          type === "session.execution.failed"
            ? normalizeExecutionError(data)
            : (error as ModelError);
        if (normalized)
          queryClient.setQueryData<ModelError | null>(qk.sessionError(sessionID), normalized);
      }
      break;
    }
    case "session.idle":
    case "session.execution.succeeded": {
      const sessionID = data.sessionID;
      if (!sessionID) break;
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        if (prev?.[sessionID]?.type === "idle") return prev;
        return { ...prev, [sessionID]: { type: "idle" } as SessionStatus };
      });
      if (type === "session.execution.succeeded" && sessionID === currentSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) });
      }
      break;
    }
    case "message.updated": {
      const info = data.info;
      if (!currentSessionId || !info || info.sessionID !== currentSessionId) break;
      const previousMessage = queryClient.getQueryData<MessagesCache>(qk.messages(currentSessionId))
        ?.messagesById[info.id];
      const newlyCompleted =
        info.role === "assistant" &&
        info.time?.completed !== undefined &&
        !(
          previousMessage?.info.role === "assistant" &&
          previousMessage.info.time?.completed !== undefined
        );
      queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
        if (!prev)
          return { messageIds: [info.id], messagesById: { [info.id]: { info, parts: [] } } };
        const existing = prev.messagesById[info.id];
        if (existing) {
          return {
            ...prev,
            messagesById: { ...prev.messagesById, [info.id]: { ...existing, info } },
          };
        }
        return {
          messageIds: [...prev.messageIds, info.id],
          messagesById: { ...prev.messagesById, [info.id]: { info, parts: [] } },
        };
      });
      if (newlyCompleted && info.tokens) {
        captureModelUsage?.({
          provider: info.providerID ?? "",
          model: info.modelID ?? "",
          tokens_total:
            info.tokens.total ??
            info.tokens.input + info.tokens.output + (info.tokens.reasoning ?? 0),
          tokens_input: info.tokens.input ?? 0,
          tokens_output: info.tokens.output ?? 0,
          tokens_reasoning: info.tokens.reasoning ?? 0,
          tokens_cache_read: info.tokens.cache?.read ?? 0,
          tokens_cache_write: info.tokens.cache?.write ?? 0,
        });
      }
      break;
    }
    case "message.part.updated": {
      const part = data.part;
      if (!currentSessionId || !part || part.sessionID !== currentSessionId) break;
      const messages = queryClient.getQueryData<MessagesCache>(qk.messages(currentSessionId));
      if (!messages?.messagesById[part.messageID]) {
        scheduleMessagesRefetch(queryClient, currentSessionId);
        break;
      }
      queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
        if (!prev) return prev;
        const msg = prev.messagesById[part.messageID];
        if (!msg) return prev;
        const partIdx = msg.parts.findIndex((p) => p.id === part.id);
        const newParts =
          partIdx >= 0 ? msg.parts.map((p, i) => (i === partIdx ? part : p)) : [...msg.parts, part];
        return {
          ...prev,
          messagesById: {
            ...prev.messagesById,
            [part.messageID]: { ...msg, parts: newParts },
          },
        };
      });
      break;
    }
    case "message.part.delta": {
      const { sessionID, messageID, partID, field, delta } = data;
      if (sessionID !== currentSessionId) break;
      const messages = queryClient.getQueryData<MessagesCache>(qk.messages(sessionID));
      const knownPart = messages?.messagesById[messageID]?.parts.some((p) => p.id === partID);
      if (!knownPart) {
        scheduleMessagesRefetch(queryClient, sessionID);
        break;
      }
      queueDelta(queryClient, { sessionID, messageID, partID, field: field || "text" }, delta);
      break;
    }
    case "message.removed": {
      const { sessionID, messageID } = data;
      if (!currentSessionId || sessionID !== currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
        if (!prev) return prev;
        const { [messageID]: _removed, ...rest } = prev.messagesById;
        return {
          messageIds: prev.messageIds.filter((id) => id !== messageID),
          messagesById: rest,
        };
      });
      break;
    }
    case "message.part.removed": {
      const { sessionID, messageID, partID } = data;
      if (!currentSessionId || sessionID !== currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
        if (!prev) return prev;
        const msg = prev.messagesById[messageID];
        if (!msg) return prev;
        return {
          ...prev,
          messagesById: {
            ...prev.messagesById,
            [messageID]: { ...msg, parts: msg.parts.filter((p) => p.id !== partID) },
          },
        };
      });
      break;
    }
    case "todo.updated": {
      const { sessionID, todos } = data;
      if (sessionID && sessionID === currentSessionId) {
        queryClient.setQueryData<Todo[]>(qk.todos(sessionID), todos);
      }
      break;
    }
    case "question.asked": {
      const props = data as QuestionRequest & { sessionID?: string };
      if (props?.sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest[]>(qk.questions(props.sessionID), (prev) => {
          const queue = prev ?? [];
          if (queue.some((question) => question.id === props.id)) return queue;
          return [...queue, props];
        });
      }
      break;
    }
    case "question.replied":
    case "question.rejected":
    case "form.replied":
    case "form.cancelled": {
      const sessionID = data.sessionID;
      const requestID = data.requestID ?? data.formID ?? data.id;
      if (sessionID === currentSessionId && requestID) {
        queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
          prev?.filter((question) => (question as unknown as { id?: string }).id !== requestID),
        );
      }
      break;
    }
    case "permission.asked": {
      const props = normalizePermissionRequest(data);
      if (props.sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest[]>(qk.permissions(props.sessionID), (prev) => {
          const queue = prev ?? [];
          if (queue.some((permission) => permission.id === props.id)) return queue;
          return [...queue, props];
        });
      }
      break;
    }
    case "permission.replied": {
      const sessionID = data.sessionID;
      const requestID = data.requestID;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest[]>(qk.permissions(sessionID), (prev) =>
          prev?.filter((permission) => permission.id !== requestID),
        );
      }
      break;
    }
    case "session.usage.updated":
    case "session.usage.recorded": {
      captureUsageFromTokens(
        captureModelUsage,
        data.tokens,
        data.providerID ?? "",
        data.modelID ?? "",
      );
      break;
    }
    // OC2 message/streaming events have no OC1 part-level equivalent. Invalidate the
    // active session's messages as a safe fallback so the UI catches up (Step 4 staged).
    case "session.message.content.updated":
    case "session.text.delta":
    case "session.reasoning.delta":
    case "session.tool.input.delta":
    case "session.tool.progress":
    case "session.tool.success":
    case "session.tool.failed":
    case "session.step.started":
    case "session.step.ended":
    case "session.step.failed":
    case "session.execution.started": {
      const sessionID = data.sessionID;
      if (sessionID && sessionID === currentSessionId) {
        scheduleMessagesRefetch(queryClient, sessionID);
      }
      break;
    }
  }
}
