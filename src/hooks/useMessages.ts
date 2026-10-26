import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { hashKey, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { hasPlaytestContext } from "@/lib/playtestPlan";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { baseToolName } from "@/lib/toolName";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { MessageWithParts } from "@/types";

export const NOOP_KEY = ["__noop__"] as const;
export const EMPTY_IDS: string[] = [];
export const EMPTY_CACHE: MessagesCache = { messageIds: [], messagesById: {} };

export function mergeMessagesSnapshot(
  before: MessagesCache | undefined,
  fetched: MessagesCache,
  after: MessagesCache | undefined,
  observedChanges?: ReadonlySet<string>,
): MessagesCache {
  const changedIds =
    observedChanges ??
    new Set(
      [...(before?.messageIds ?? []), ...(after?.messageIds ?? [])].filter(
        (messageID) => before?.messagesById[messageID] !== after?.messagesById[messageID],
      ),
    );
  if (changedIds.size === 0) return fetched;

  const messagesById = { ...fetched.messagesById };
  const deletedIds = new Set(
    [...changedIds].filter((messageID) => !after?.messagesById[messageID]),
  );
  for (const messageID of deletedIds) delete messagesById[messageID];

  const concurrentlyUpdatedIds: string[] = [];
  for (const messageID of after?.messageIds ?? []) {
    const updatedMessage = after?.messagesById[messageID];
    if (changedIds.has(messageID) && updatedMessage) {
      messagesById[messageID] = updatedMessage;
      concurrentlyUpdatedIds.push(messageID);
    }
  }

  const messageIds = fetched.messageIds.filter((messageID) => !deletedIds.has(messageID));
  const knownIds = new Set(messageIds);
  for (const messageID of concurrentlyUpdatedIds) {
    if (!knownIds.has(messageID)) messageIds.push(messageID);
  }
  return { messageIds, messagesById };
}

export async function fetchMessages(
  client: OpencodeClient,
  queryClient: QueryClient,
  sessionID: string,
): Promise<MessagesCache> {
  const queryKey = qk.messages(sessionID);
  const before = queryClient.getQueryData<MessagesCache>(queryKey);
  let observed = before;
  const observedChanges = new Set<string>();
  const queryHash = hashKey(queryKey);
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== queryHash) return;
    const next = event.query.state.data as MessagesCache | undefined;
    if (next === observed) return;
    const messageIds = new Set([...(observed?.messageIds ?? []), ...(next?.messageIds ?? [])]);
    for (const messageID of messageIds) {
      if (observed?.messagesById[messageID] !== next?.messagesById[messageID]) {
        observedChanges.add(messageID);
      }
    }
    observed = next;
  });
  let res: Awaited<ReturnType<OpencodeClient["session"]["messages"]>>;
  try {
    res = await client.session.messages({ sessionID }, { throwOnError: true });
  } finally {
    unsubscribe();
  }
  const messageIds: string[] = [];
  const messagesById: Record<string, MessageWithParts> = {};
  for (const msg of res.data ?? []) {
    messageIds.push(msg.info.id);
    messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
  }
  return mergeMessagesSnapshot(
    before,
    { messageIds, messagesById },
    queryClient.getQueryData<MessagesCache>(queryKey),
    observedChanges,
  );
}

export function useMessageIds(): string[] {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  const { data } = useQuery<MessagesCache, Error, string[]>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messageIds, []),
  });
  return data ?? EMPTY_IDS;
}

export function useMessage(messageId: string): MessageWithParts | undefined {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<MessagesCache, Error, MessageWithParts | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messagesById[messageId], [messageId]),
  }).data;
}

/**
 * Role of one message as a primitive. The chat container used to select the
 * whole last message object, which subscribed it to every streamed token and
 * re-rendered the virtualized list on each delta.
 */
export function useMessageRole(messageId: string | null): "user" | "assistant" | null {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  const { data } = useQuery<MessagesCache, Error, "user" | "assistant" | null>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback(
      (d: MessagesCache) => {
        const role = messageId ? d.messagesById[messageId]?.info.role : undefined;
        return role === "user" || role === "assistant" ? role : null;
      },
      [messageId],
    ),
  });
  return data ?? null;
}

/** Whether one message is an assistant turn that failed. Primitive, see `useMessageRole`. */
export function useMessageHasError(messageId: string | null): boolean {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  const { data } = useQuery<MessagesCache, Error, boolean>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback(
      (d: MessagesCache) => {
        const info = messageId ? d.messagesById[messageId]?.info : undefined;
        return info?.role === "assistant" && Boolean(info.error);
      },
      [messageId],
    ),
  });
  return data ?? false;
}

/**
 * The id of the last message in the task turn that most recently wrote the
 * session's todo list, extended through the consecutive assistant messages
 * that close that turn. The todo panel anchors just after this message so it
 * stays with its turn once newer messages are added below it. Null while the
 * history has no todo write yet (or hasn't loaded).
 */
export function useTodoAnchorMessageId(): string | null {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return (
    useQuery<MessagesCache, Error, string | null>({
      queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
      queryFn: () =>
        client && activeSessionId
          ? fetchMessages(client, queryClient, activeSessionId)
          : Promise.resolve(EMPTY_CACHE),
      enabled: ready && !!client && !!activeSessionId,
      select: useCallback((cache: MessagesCache) => {
        let lastWriteIndex = -1;
        cache.messageIds.forEach((id, index) => {
          const parts = cache.messagesById[id]?.parts;
          if (
            parts?.some((part) => part.type === "tool" && baseToolName(part.tool) === "todowrite")
          ) {
            lastWriteIndex = index;
          }
        });
        if (lastWriteIndex === -1) return null;
        let endIndex = lastWriteIndex;
        while (
          endIndex + 1 < cache.messageIds.length &&
          cache.messagesById[cache.messageIds[endIndex + 1]]?.info.role === "assistant"
        ) {
          endIndex += 1;
        }
        return cache.messageIds[endIndex];
      }, []),
    }).data ?? null
  );
}

/**
 * Whether the active chat has any text a playtest plan can be built from.
 * Undefined until its messages load.
 */
export function useHasPlaytestContext(): boolean | undefined {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<MessagesCache, Error, boolean>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback(
      (d: MessagesCache) =>
        hasPlaytestContext(d.messageIds.flatMap((id) => d.messagesById[id] ?? [])),
      [],
    ),
  }).data;
}
