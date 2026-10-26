import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import type { QueryClient } from "@tanstack/react-query";
import { Data, Effect, Schema } from "effect";
import type { ModelError } from "@/lib/modelError";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import type { MessageWithParts } from "@/types";

export interface MessagesCache {
  messageIds: string[];
  messagesById: Record<string, MessageWithParts>;
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

const SseEventEnvelopeSchema = Schema.Struct({
  type: Schema.String,
  properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

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
        dispatchEvent(queryClient, envelope as Event, activeSessionIdRef, captureModelUsage),
      ),
    ),
  );
}

function dispatchEvent(
  queryClient: QueryClient,
  event: Event,
  activeSessionIdRef: { current: string | null },
  captureModelUsage?: (usage: ModelUsageEvent) => void,
): void {
  const currentSessionId = activeSessionIdRef.current;

  // Anything that rewrites a part, or a message, must land after the text
  // already streamed into the cache.
  if (event.type !== "message.part.delta") flushSseDeltas();

  switch (event.type) {
    case "session.created": {
      const { info } = event.properties;
      if (!isVisibleSession(info)) break;
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return [info];
        if (prev.some((s) => s.id === info.id)) return prev;
        return [info, ...prev];
      });
      break;
    }
    case "session.updated": {
      const { info } = event.properties;
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.map((s) => (s.id === info.id ? info : s));
      });
      break;
    }
    case "session.deleted": {
      const { info } = event.properties;
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== info.id);
      });
      queryClient.removeQueries({ queryKey: qk.session(info.id) });
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        if (!prev?.[info.id]) return prev;
        const { [info.id]: _deleted, ...remaining } = prev;
        return remaining;
      });
      break;
    }
    case "session.status": {
      const { sessionID, status } = event.properties;
      if (status.type !== "idle") {
        queryClient.setQueryData<ModelError | null>(qk.sessionError(sessionID), null);
      }
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        return { ...prev, [sessionID]: status };
      });
      break;
    }
    case "session.compacted": {
      const { sessionID } = event.properties;
      if (sessionID === currentSessionId) {
        void queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) });
      }
      break;
    }
    case "session.error": {
      const sessionID = event.properties.sessionID ?? currentSessionId;
      if (!sessionID) break;

      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => ({
        ...prev,
        [sessionID]: { type: "idle" } as SessionStatus,
      }));
      if (
        sessionID === currentSessionId &&
        event.properties.error &&
        event.properties.error.name !== "MessageAbortedError"
      ) {
        queryClient.setQueryData<ModelError | null>(
          qk.sessionError(sessionID),
          event.properties.error,
        );
      }
      break;
    }
    case "session.idle": {
      const { sessionID } = event.properties;
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
        if (prev?.[sessionID]?.type === "idle") return prev;
        return { ...prev, [sessionID]: { type: "idle" } as SessionStatus };
      });
      break;
    }
    case "message.updated": {
      const { info } = event.properties;
      if (info.sessionID !== currentSessionId) break;
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
      if (newlyCompleted) {
        captureModelUsage?.({
          provider: info.providerID,
          model: info.modelID,
          tokens_total:
            info.tokens.total ?? info.tokens.input + info.tokens.output + info.tokens.reasoning,
          tokens_input: info.tokens.input,
          tokens_output: info.tokens.output,
          tokens_reasoning: info.tokens.reasoning,
          tokens_cache_read: info.tokens.cache.read,
          tokens_cache_write: info.tokens.cache.write,
        });
      }
      break;
    }
    case "message.part.updated": {
      const { part } = event.properties;
      if (part.sessionID !== currentSessionId) break;
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
      const { sessionID, messageID, partID, field, delta } = event.properties;
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
      const { sessionID, messageID } = event.properties;
      if (sessionID !== currentSessionId) break;
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
      const { sessionID, messageID, partID } = event.properties;
      if (sessionID !== currentSessionId) break;
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
      const { sessionID, todos } = event.properties;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<Todo[]>(qk.todos(currentSessionId), todos);
      }
      break;
    }
    case "question.asked": {
      const props = event.properties;
      if (props.sessionID === currentSessionId) {
        // One slot holds the whole queue: a second question must not replace
        // the one the user is still looking at.
        queryClient.setQueryData<QuestionRequest[]>(qk.questions(props.sessionID), (prev) => {
          const queue = prev ?? [];
          if (queue.some((question) => question.id === props.id)) return queue;
          return [...queue, props];
        });
      }
      break;
    }
    case "question.replied":
    case "question.rejected": {
      const { sessionID, requestID } = event.properties;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest[]>(qk.questions(sessionID), (prev) =>
          prev?.filter((question) => question.id !== requestID),
        );
      }
      break;
    }
    case "permission.asked": {
      const props = event.properties;
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
      const { sessionID, requestID } = event.properties;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest[]>(qk.permissions(sessionID), (prev) =>
          prev?.filter((permission) => permission.id !== requestID),
        );
      }
      break;
    }
  }
}
