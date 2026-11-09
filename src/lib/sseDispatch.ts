import type { QueryClient } from "@tanstack/react-query";
import { Data, Effect, Schema } from "effect";
import { toast } from "sonner";
import type { ModelError } from "@/lib/modelError";
import { normalizeExecutionError, normalizePermissionRequest } from "@/lib/oc2Normalize";
import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@/lib/opencode";
import { translateOc2Form } from "@/lib/opencode/forms";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { baseToolName } from "@/lib/toolName";
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

/** Which model each live assistant step is running on, for usage analytics. */
const oc2StepModels = new Map<string, { providerID?: string; modelID?: string }>();

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

function oc2PartId(messageID: string, kind: string, ordinal: number | string): string {
  return `${messageID}:${kind}:${ordinal}`;
}

/** Ensure an assistant message exists and apply a part-level mutation to it. */
function mutateOc2Part(
  queryClient: QueryClient,
  sessionID: string,
  messageID: string,
  partID: string,
  create: () => Record<string, any>,
  mutate: (part: Record<string, any>) => void,
): void {
  queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
    if (!prev) {
      // Opened mid-stream: start streaming immediately and fetch history once.
      scheduleMessagesRefetch(queryClient, sessionID);
    }
    const cache: MessagesCache = prev ?? { messageIds: [], messagesById: {} };
    const existingMessage = cache.messagesById[messageID];
    const message: MessageWithParts = existingMessage ?? {
      info: {
        id: messageID,
        sessionID,
        role: "assistant",
        time: { created: Date.now() },
      } as MessageWithParts["info"],
      parts: [],
    };
    const parts = [...(message.parts as unknown as Array<Record<string, any>>)];
    const index = parts.findIndex((part) => part.id === partID);
    const part = index >= 0 ? { ...parts[index] } : create();
    mutate(part);
    if (index >= 0) parts[index] = part;
    else parts.push(part);
    return {
      ...cache,
      messageIds: existingMessage ? cache.messageIds : [...cache.messageIds, messageID],
      messagesById: {
        ...cache.messagesById,
        [messageID]: { ...message, parts: parts as unknown as MessageWithParts["parts"] },
      },
    };
  });
}

function updateOc2AssistantInfo(
  queryClient: QueryClient,
  sessionID: string,
  messageID: string,
  patch: Record<string, unknown>,
): void {
  queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
    if (!prev) return prev;
    const existing = prev.messagesById[messageID];
    if (!existing) return prev;
    return {
      ...prev,
      messagesById: {
        ...prev.messagesById,
        [messageID]: {
          ...existing,
          info: { ...existing.info, ...patch } as MessageWithParts["info"],
        },
      },
    };
  });
}

function toolContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry: any) => (entry?.type === "text" ? entry.text : ""))
    .filter(Boolean)
    .join("\n");
}

function dispatchEvent(
  queryClient: QueryClient,
  event: unknown,
  activeSessionIdRef: { current: string | null },
  captureModelUsage?: (usage: ModelUsageEvent) => void,
): void {
  const currentSessionId = activeSessionIdRef.current;
  // biome-ignore lint/suspicious/noExplicitAny: staged OC1/OC2 event reconciliation boundary
  const data = eventData(event) as Record<string, any>;
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
      const info = data.info as { id?: string } | undefined;
      const id = (info?.id ?? data.sessionID ?? data.id) as string | undefined;
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
      const sessionID = data.sessionID as string | undefined;
      const status = data.status as SessionStatus | undefined;
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
    case "form.created": {
      // OC2 form -> OC1 question so BloxMind's question UI can render it.
      const form = data.form ?? data;
      const question = translateOc2Form(form);
      if (question?.sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest[]>(qk.questions(question.sessionID), (prev) => {
          const queue = prev ?? [];
          if (queue.some((entry) => entry.id === question.id)) return queue;
          return [...queue, question];
        });
      } else if (!question && form?.id) {
        // All-external/hidden fields can't be answered inline — the turn would
        // otherwise look dead while the engine waits on a browser prompt.
        toast("The engine needs something only a browser can give it", {
          id: `form-unanswerable-${form.id}`,
          description: "Complete the sign-in or prompt that OpenCode opened outside this window.",
        });
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
    case "session.usage.updated": {
      // Raw usage reports carry no provider/model; the assistant step we
      // attributed at `step.started` is the source of usage capture instead.
      break;
    }
    // Durable-replay only in OC2 v2.2.6: rebuilding parts here would clobber the
    // synthesized streaming ids, so just refetch the message instead.
    case "session.message.content.updated": {
      const sessionID = data.sessionID as string | undefined;
      if (sessionID && sessionID === currentSessionId) {
        scheduleMessagesRefetch(queryClient, sessionID);
      }
      break;
    }
    // OC2 token/part streaming. Parts are keyed by assistant message + ordinal so
    // deltas append in place, then the authoritative text at `*.ended` wins.
    case "session.text.started":
    case "session.text.delta":
    case "session.text.ended": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID) break;
      const ordinal = Number(data.ordinal ?? 0);
      const partID = oc2PartId(messageID, "text", ordinal);
      mutateOc2Part(
        queryClient,
        sessionID,
        messageID,
        partID,
        () => ({
          id: partID,
          sessionID,
          messageID,
          type: "text",
          text: "",
          time: { start: Date.now() },
        }),
        (part) => {
          if (type === "session.text.delta") part.text = `${part.text ?? ""}${data.delta ?? ""}`;
          else if (type === "session.text.ended" && typeof data.text === "string") {
            part.text = data.text;
            part.time = { ...(part.time as object), end: Date.now() };
          }
        },
      );
      break;
    }
    case "session.reasoning.started":
    case "session.reasoning.delta":
    case "session.reasoning.ended": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID) break;
      const ordinal = Number(data.ordinal ?? 0);
      const partID = oc2PartId(messageID, "reasoning", ordinal);
      mutateOc2Part(
        queryClient,
        sessionID,
        messageID,
        partID,
        () => ({
          id: partID,
          sessionID,
          messageID,
          type: "reasoning",
          text: "",
          time: { start: Date.now() },
        }),
        (part) => {
          if (type === "session.reasoning.delta") {
            part.text = `${part.text ?? ""}${data.delta ?? ""}`;
          } else if (type === "session.reasoning.ended" && typeof data.text === "string") {
            part.text = data.text;
            part.time = { ...(part.time as object), end: Date.now() };
          }
        },
      );
      break;
    }
    case "session.tool.input.started":
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.called":
    case "session.tool.progress":
    case "session.tool.success":
    case "session.tool.failed": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      const callID = data.id as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID || !callID) break;
      const partID = oc2PartId(messageID, "tool", callID);
      let toolName = "";
      mutateOc2Part(
        queryClient,
        sessionID,
        messageID,
        partID,
        () => ({
          id: partID,
          sessionID,
          messageID,
          type: "tool",
          tool: data.name ?? "tool",
          callID,
          state: { status: "running", input: {}, metadata: {}, time: { start: Date.now() } },
        }),
        (part) => {
          const state =
            part.state && typeof part.state === "object"
              ? (part.state as Record<string, unknown>)
              : {};
          part.state = state;
          if (type === "session.tool.input.started" && typeof data.name === "string") {
            part.tool = data.name;
          } else if (type === "session.tool.input.delta") {
            state.raw = `${state.raw ?? ""}${data.delta ?? ""}`;
          } else if (type === "session.tool.input.ended") {
            state.raw = data.text ?? state.raw ?? "";
            if (typeof data.text === "string") {
              try {
                const parsed = JSON.parse(data.text);
                if (parsed && typeof parsed === "object") state.input = parsed;
              } catch {
                // Partial or non-JSON input; keep the raw text for debugging.
              }
            }
          } else if (type === "session.tool.called") {
            state.status = "running";
            if (data.input && typeof data.input === "object") state.input = data.input;
          } else if (type === "session.tool.progress") {
            if (data.metadata && typeof data.metadata === "object") {
              state.metadata = { ...(state.metadata as object), ...data.metadata };
            }
          } else if (type === "session.tool.success") {
            state.status = "completed";
            state.output = toolContentText(data.content);
            state.metadata = data.metadata ?? state.metadata ?? {};
            state.title = (data.metadata as { title?: string } | undefined)?.title ?? "";
            state.time = { ...(state.time as object), end: Date.now() };
          } else if (type === "session.tool.failed") {
            state.status = "error";
            state.error =
              (data.error as { message?: string; type?: string } | undefined)?.message ??
              (data.error as { type?: string } | undefined)?.type ??
              "Tool failed";
            state.metadata = data.metadata ?? state.metadata ?? {};
            state.time = { ...(state.time as object), end: Date.now() };
          }
          if (typeof part.tool === "string") toolName = part.tool;
        },
      );
      // OC2 has no todo.updated event; refresh the todos panel once a todowrite lands.
      if (
        (type === "session.tool.success" || type === "session.tool.failed") &&
        baseToolName(toolName) === "todowrite"
      ) {
        void queryClient.invalidateQueries({ queryKey: qk.todos(sessionID) });
      }
      break;
    }
    case "session.step.started": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID) break;
      const model = data.model as
        | { providerID?: string; id?: string; modelID?: string }
        | undefined;
      const stepID = oc2PartId(messageID, "step", data.started ?? Date.now());
      mutateOc2Part(
        queryClient,
        sessionID,
        messageID,
        stepID,
        () => ({ id: stepID, sessionID, messageID, type: "step-start" }),
        () => {},
      );
      oc2StepModels.set(`${sessionID}:${messageID}`, {
        providerID: model?.providerID,
        modelID: model?.id ?? model?.modelID,
      });
      updateOc2AssistantInfo(queryClient, sessionID, messageID, {
        providerID: model?.providerID,
        modelID: model?.id ?? model?.modelID,
        ...(model ? { model } : {}),
        ...(typeof data.agent === "string" ? { agent: data.agent } : {}),
        time: { created: data.started ?? Date.now() },
      });
      break;
    }
    case "session.step.ended": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID) break;
      updateOc2AssistantInfo(queryClient, sessionID, messageID, {
        finish: data.finish,
        ...(data.tokens ? { tokens: data.tokens } : {}),
        ...(typeof data.cost === "number" ? { cost: data.cost } : {}),
        time: { created: Date.now(), completed: Date.now() },
      });
      const usage = oc2StepModels.get(`${sessionID}:${messageID}`);
      oc2StepModels.delete(`${sessionID}:${messageID}`);
      if (data.tokens) {
        captureUsageFromTokens(
          captureModelUsage,
          data.tokens,
          usage?.providerID ?? "",
          usage?.modelID ?? "",
        );
      }
      break;
    }
    case "session.step.failed": {
      const sessionID = data.sessionID as string | undefined;
      const messageID = data.assistantMessageID as string | undefined;
      if (!sessionID || sessionID !== currentSessionId || !messageID) break;
      const error = normalizeExecutionError(data);
      oc2StepModels.delete(`${sessionID}:${messageID}`);
      updateOc2AssistantInfo(queryClient, sessionID, messageID, {
        ...(error ? { error } : {}),
        time: { created: Date.now(), completed: Date.now() },
      });
      break;
    }
    case "session.execution.started": {
      const sessionID = data.sessionID;
      if (sessionID && sessionID === currentSessionId) {
        scheduleMessagesRefetch(queryClient, sessionID);
      }
      break;
    }
  }
}
