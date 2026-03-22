import type {
  Event,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import type { QueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import type { MessageWithParts } from "@/types";

export interface MessagesCache {
  messageIds: string[];
  messagesById: Record<string, MessageWithParts>;
}

/**
 * Maps an SSE Event to query cache updates.
 * `activeSessionIdRef` is a ref so we can read it without restarting the SSE loop.
 */
export function sseDispatch(
  queryClient: QueryClient,
  event: Event,
  activeSessionIdRef: { current: string | null },
) {
  if (!event || !event.type) return;

  const currentSessionId = activeSessionIdRef.current;

  switch (event.type) {
    case "session.created": {
      const session = event.properties.info as Session | undefined;
      if (session) {
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return [session];
          if (prev.some((s) => s.id === session.id)) return prev;
          return [session, ...prev];
        });
      }
      break;
    }
    case "session.updated": {
      const session = event.properties.info as Session | undefined;
      if (session) {
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return prev;
          return prev.map((s) => (s.id === session.id ? session : s));
        });
      }
      break;
    }
    case "session.deleted": {
      const session = event.properties.info as Session | undefined;
      if (session) {
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return prev;
          return prev.filter((s) => s.id !== session.id);
        });
      }
      break;
    }
    case "session.status": {
      const { sessionID, status } = event.properties as {
        sessionID?: string;
        status?: SessionStatus;
      };
      if (sessionID && status) {
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
          const prevStatus = prev?.[sessionID];
          if (prevStatus?.type === status.type) return prev;
          return { ...prev, [sessionID]: status };
        });
      }
      break;
    }
    case "session.idle": {
      const { sessionID } = event.properties as { sessionID?: string };
      if (sessionID) {
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
          if (prev?.[sessionID]?.type === "idle") return prev;
          return { ...prev, [sessionID]: { type: "idle" } as SessionStatus };
        });
      }
      break;
    }
    case "message.updated": {
      const info = event.properties.info as Message;
      if (info && info.sessionID === currentSessionId) {
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
      }
      break;
    }
    case "message.part.updated": {
      const part = event.properties.part as Part;
      if (part && part.sessionID === currentSessionId) {
        queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[part.messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);
          let newParts: Part[];
          if (partIdx >= 0) {
            newParts = [...msg.parts];
            newParts[partIdx] = part;
          } else {
            newParts = [...msg.parts, part];
          }
          return {
            ...prev,
            messagesById: {
              ...prev.messagesById,
              [part.messageID]: { ...msg, parts: newParts },
            },
          };
        });
      }
      break;
    }
    case "message.part.delta": {
      const { messageID, partID, field, delta } = event.properties as {
        messageID?: string;
        partID?: string;
        field?: string;
        delta?: string;
      };
      if (messageID && partID && currentSessionId) {
        queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === partID);
          if (partIdx < 0) return prev;
          const part = { ...msg.parts[partIdx] };
          const key = field || "text";
          if (key in part && typeof (part as Record<string, unknown>)[key] === "string") {
            (part as Record<string, unknown>)[key] =
              ((part as Record<string, unknown>)[key] as string) + (delta as string);
          }
          const newParts = [...msg.parts];
          newParts[partIdx] = part as Part;
          return {
            ...prev,
            messagesById: { ...prev.messagesById, [messageID]: { ...msg, parts: newParts } },
          };
        });
      }
      break;
    }
    case "message.removed": {
      const { sessionID, messageID } = event.properties as {
        sessionID?: string;
        messageID?: string;
      };
      if (sessionID === currentSessionId && messageID) {
        queryClient.setQueryData<MessagesCache>(qk.messages(currentSessionId), (prev) => {
          if (!prev) return prev;
          const { [messageID]: _removed, ...rest } = prev.messagesById;
          return {
            messageIds: prev.messageIds.filter((id) => id !== messageID),
            messagesById: rest,
          };
        });
      }
      break;
    }
    case "message.part.removed": {
      const { sessionID, messageID, partID } = event.properties as {
        sessionID?: string;
        messageID?: string;
        partID?: string;
      };
      if (sessionID === currentSessionId && messageID) {
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
      }
      break;
    }
    case "todo.updated": {
      const { sessionID, todos: newTodos } = event.properties as {
        sessionID?: string;
        todos?: Todo[];
      };
      if (sessionID === currentSessionId && Array.isArray(newTodos)) {
        queryClient.setQueryData<Todo[]>(qk.todos(currentSessionId), newTodos);
      }
      break;
    }
    case "question.asked": {
      const qr = event.properties as unknown as QuestionRequest;
      if (qr && qr.sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest | null>(qk.questions, qr);
      }
      break;
    }
    case "question.replied":
    case "question.rejected": {
      const { sessionID } = event.properties as { sessionID?: string };
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<QuestionRequest | null>(qk.questions, null);
      }
      break;
    }
    case "permission.asked": {
      const pr = event.properties as unknown as PermissionRequest;
      if (pr && pr.sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest | null>(qk.permissions, pr);
      }
      break;
    }
    case "permission.replied": {
      const { sessionID } = event.properties as { sessionID?: string };
      if (sessionID === currentSessionId) {
        queryClient.setQueryData<PermissionRequest | null>(qk.permissions, null);
      }
      break;
    }
  }
}
