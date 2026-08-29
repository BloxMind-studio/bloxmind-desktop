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
import { toast } from "sonner";
import type { ModelError } from "@/lib/modelError";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { isSilentContinueMessage } from "@/lib/silentContinue";
import type { MessageWithParts } from "@/types";

/** Remove a message from the cache (both ordering and body) without mutating. */
function dropMessage(prev: MessagesCache, messageID: string): MessagesCache {
  const { [messageID]: _removed, ...rest } = prev.messagesById;
  return {
    messageIds: prev.messageIds.filter((id) => id !== messageID),
    messagesById: rest,
  };
}

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
    sseDispatchEffect(
      queryClient,
      event,
      activeSessionIdRef,
      captureModelUsage,
    ).pipe(
      Effect.catchAll((error) =>
        Effect.logWarning(
          `sseDispatch: malformed ${error.eventType} event, skipping`,
          error.cause,
        ),
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
  if (!event || typeof event !== "object" || !("type" in event))
    return Effect.void;

  return Schema.decodeUnknown(SseEventEnvelopeSchema)(event).pipe(
    Effect.mapError(
      (cause) =>
        new SseDispatchError({
          eventType:
            "type" in event && typeof event.type === "string"
              ? event.type
              : "unknown",
          cause,
        }),
    ),
    Effect.flatMap((envelope) =>
      Effect.sync(() =>
        dispatchEvent(
          queryClient,
          envelope as Event,
          activeSessionIdRef,
          captureModelUsage,
        ),
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
      if (info.id === currentSessionId) {
        console.debug(
          `[sseDispatch] the ACTIVE session was deleted by the engine: ${info.id}`,
        );
      }
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== info.id);
      });
      queryClient.removeQueries({ queryKey: qk.session(info.id) });
      queryClient.setQueryData<Record<string, SessionStatus>>(
        qk.statuses,
        (prev) => {
          if (!prev?.[info.id]) return prev;
          const { [info.id]: _deleted, ...remaining } = prev;
          return remaining;
        },
      );
      break;
    }
    case "session.status": {
      const { sessionID, status } = event.properties;
      if (status.type !== "idle") {
        queryClient.setQueryData<ModelError | null>(
          qk.sessionError(sessionID),
          null,
        );
      }
      queryClient.setQueryData<Record<string, SessionStatus>>(
        qk.statuses,
        (prev) => {
          return { ...prev, [sessionID]: status };
        },
      );
      // Mirror the idle-session refetch (see `session.idle`): when a session
      // reports idle via the status event, pull the authoritative messages so
      // any parts dropped from the SSE stream get restored.
      if (status.type === "idle" && sessionID === currentSessionId) {
        void queryClient.invalidateQueries({
          queryKey: qk.messages(sessionID),
          refetchType: "active",
        });
        void queryClient.invalidateQueries({
          queryKey: qk.todos(sessionID),
          refetchType: "active",
        });
      }
      break;
    }
    case "session.compacted": {
      const { sessionID } = event.properties;
      if (sessionID === currentSessionId) {
        void queryClient.invalidateQueries({
          queryKey: qk.messages(sessionID),
        });
      }
      break;
    }
    case "session.error": {
      const sessionID = event.properties.sessionID ?? currentSessionId;
      if (!sessionID) break;

      queryClient.setQueryData<Record<string, SessionStatus>>(
        qk.statuses,
        (prev) => ({
          ...prev,
          [sessionID]: { type: "idle" } as SessionStatus,
        }),
      );
      const err = event.properties.error;
      if (
        sessionID === currentSessionId &&
        err &&
        err.name !== "MessageAbortedError"
      ) {
        queryClient.setQueryData<ModelError | null>(
          qk.sessionError(sessionID),
          err,
        );
        const data = err.data as { message?: string } | undefined;
        const msg = data?.message ?? String(err);
        toast.error("OpenCode error", {
          description: msg.slice(0, 200),
          duration: 8000,
        });
      }
      break;
    }
    case "session.idle": {
      const { sessionID } = event.properties;
      queryClient.setQueryData<Record<string, SessionStatus>>(
        qk.statuses,
        (prev) => {
          if (prev?.[sessionID]?.type === "idle") return prev;
          return { ...prev, [sessionID]: { type: "idle" } as SessionStatus };
        },
      );
      // The OpenCode engine (anomalyco/opencode >= 1.14.42) drops SyncEvent
      // publishes — notably `message.part.updated` — from the `/event` SSE
      // stream, so message shells appear but their parts never arrive over
      // SSE. The persisted store is still authoritative, so refetch the
      // messages once the agent goes idle to pull the completed parts.
      if (sessionID === currentSessionId) {
        void queryClient.invalidateQueries({
          queryKey: qk.messages(sessionID),
          refetchType: "active",
        });
        void queryClient.invalidateQueries({
          queryKey: qk.todos(sessionID),
          refetchType: "active",
        });
      }
      break;
    }
    case "message.updated": {
      const { info } = event.properties;
      if (info.sessionID !== currentSessionId) break;
      const previousMessage = queryClient.getQueryData<MessagesCache>(
        qk.messages(currentSessionId),
      )?.messagesById[info.id];
      const newlyCompleted =
        info.role === "assistant" &&
        info.time?.completed !== undefined &&
        !(
          previousMessage?.info.role === "assistant" &&
          previousMessage.info.time?.completed !== undefined
        );
      queryClient.setQueryData<MessagesCache>(
        qk.messages(currentSessionId),
        (prev) => {
          if (!prev)
            return {
              messageIds: [info.id],
              messagesById: { [info.id]: { info, parts: [] } },
            };
          const existing = prev.messagesById[info.id];
          if (existing) {
            return {
              ...prev,
              messagesById: {
                ...prev.messagesById,
                [info.id]: { ...existing, info },
              },
            };
          }
          return {
            messageIds: [...prev.messageIds, info.id],
            messagesById: {
              ...prev.messagesById,
              [info.id]: { info, parts: [] },
            },
          };
        },
      );
      if (newlyCompleted) {
        captureModelUsage?.({
          provider: info.providerID,
          model: info.modelID,
          tokens_total:
            info.tokens.total ??
            info.tokens.input + info.tokens.output + info.tokens.reasoning,
          tokens_input: info.tokens.input,
          tokens_output: info.tokens.output,
          tokens_reasoning: info.tokens.reasoning,
          tokens_cache_read: info.tokens.cache.read,
          tokens_cache_write: info.tokens.cache.write,
        });
        // Natural completion — clear any stale interrupted/shouldContinue flags
        // so the Continue button and "you left" block disappear forever for this
        // completed prompt (requirement 2).
        try {
          localStorage.removeItem(`BloxMind:interrupted:${info.sessionID}`);
          localStorage.setItem(`BloxMind:lastKnownState:${info.sessionID}`, "idle");
        } catch {
          // ignore storage errors
        }
        // The instant SSE reports the assistant message completed, refetch its
        // final parts instead of waiting for the next poll tick.
        void queryClient.invalidateQueries({
          queryKey: qk.messages(info.sessionID),
          refetchType: "active",
        });
      }
      break;
    }
    case "message.part.updated": {
      const { part } = event.properties;
      if (part.sessionID !== currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(
        qk.messages(currentSessionId),
        (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[part.messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);
          const newParts =
            partIdx >= 0
              ? msg.parts.map((p, i) => (i === partIdx ? part : p))
              : [...msg.parts, part];
          const nextMsg = { ...msg, parts: newParts };
          // Silent-continue user messages never render: drop them from the cache
          // as soon as the marker text is known so no empty/invisible bubble is
          // ever shown in the stream (no placeholder, no blank gap).
          if (isSilentContinueMessage(nextMsg))
            return dropMessage(prev, part.messageID);
          return {
            ...prev,
            messagesById: { ...prev.messagesById, [part.messageID]: nextMsg },
          };
        },
      );
      break;
    }
    case "message.part.delta": {
      const { messageID, partID, field, delta } = event.properties;
      if (!currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(
        qk.messages(currentSessionId),
        (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === partID);
          if (partIdx < 0) return prev;
          const part = { ...msg.parts[partIdx] };
          const key = field || "text";
          if (
            key in part &&
            typeof (part as Record<string, unknown>)[key] === "string"
          ) {
            (part as Record<string, unknown>)[key] =
              ((part as Record<string, unknown>)[key] as string) + delta;
          }
          const newParts = msg.parts.map((p, i) => (i === partIdx ? part : p));
          const nextMsg = { ...msg, parts: newParts };
          // Drop the silent-continue user message once its streamed marker text
          // (assembled via deltas) is complete.
          if (isSilentContinueMessage(nextMsg))
            return dropMessage(prev, messageID);
          return {
            ...prev,
            messagesById: { ...prev.messagesById, [messageID]: nextMsg },
          };
        },
      );
      break;
    }
    case "message.removed": {
      const { sessionID, messageID } = event.properties;
      if (sessionID !== currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(
        qk.messages(currentSessionId),
        (prev) => {
          if (!prev) return prev;
          const { [messageID]: _removed, ...rest } = prev.messagesById;
          return {
            messageIds: prev.messageIds.filter((id) => id !== messageID),
            messagesById: rest,
          };
        },
      );
      break;
    }
    case "message.part.removed": {
      const { sessionID, messageID, partID } = event.properties;
      if (sessionID !== currentSessionId) break;
      queryClient.setQueryData<MessagesCache>(
        qk.messages(currentSessionId),
        (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[messageID];
          if (!msg) return prev;
          return {
            ...prev,
            messagesById: {
              ...prev.messagesById,
              [messageID]: {
                ...msg,
                parts: msg.parts.filter((p) => p.id !== partID),
              },
            },
          };
        },
      );
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
        queryClient.setQueryData<QuestionRequest | null>(
          qk.questions(props.sessionID),
          props,
        );
      }
      break;
    }
    case "question.replied":
    case "question.rejected": {
      const { sessionID } = event.properties;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest | null>(
          qk.questions(sessionID),
          null,
        );
      }
      break;
    }
    case "permission.asked": {
      const props = event.properties;
      if (props.sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest | null>(
          qk.permissions(props.sessionID),
          props,
        );
      }
      break;
    }
    case "permission.replied": {
      const { sessionID } = event.properties;
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest | null>(
          qk.permissions(sessionID),
          null,
        );
      }
      break;
    }
  }
}


