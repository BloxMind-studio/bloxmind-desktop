import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { hashKey, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
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

  // The engine drops sessions on restart (it does not persist transcripts), so
  // an existing session may be unknown to it now. Re-register it under the same
  // id so prompts work again; the history itself is restored from the local
  // store below.
  const engineMessages = await loadEngineMessages(client, sessionID);
  const local = await readLocalMessages(sessionID);
  const fetched = mergeMessagesLocalFirst(local, engineMessages);
  unsubscribe();

  return mergeMessagesSnapshot(
    before,
    fetched,
    queryClient.getQueryData<MessagesCache>(queryKey),
    observedChanges,
  );
}

async function loadEngineMessages(
  client: OpencodeClient,
  sessionID: string,
): Promise<Array<{ info: MessageWithParts["info"]; parts: MessageWithParts["parts"] }>> {
  try {
    const res = await client.session.messages({ sessionID }, { throwOnError: true });
    return (res.data ?? []) as Array<{
      info: MessageWithParts["info"];
      parts: MessageWithParts["parts"];
    }>;
  } catch {
    try {
      const directory = await desktop.prepareSessionWorkspace(sessionID);
      await client.v2.session.create(
        { id: sessionID, location: { directory } },
        { throwOnError: true },
      );
    } catch {
      // Re-registration failed; the next prompt will surface the real error.
    }
    return [];
  }
}

async function readLocalMessages(sessionID: string): Promise<MessagesCache | null> {
  try {
    const stored = await desktop.sessionStoreGet(sessionID);
    return (stored?.messages as MessagesCache | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the snapshot from the engine result, overlaying any history that only
 * survives in BloxMind's local transcript store (engine order first so the
 * newest engine messages stay at the tail, local history ids kept otherwise).
 */
export function mergeMessagesLocalFirst(
  local: MessagesCache | null,
  engine: Array<{ info: MessageWithParts["info"]; parts: MessageWithParts["parts"] }>,
): MessagesCache {
  const messagesById: Record<string, MessageWithParts> = { ...(local?.messagesById ?? {}) };
  const messageIds = [...(local?.messageIds ?? [])];
  for (const msg of engine) {
    messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
    if (!messageIds.includes(msg.info.id)) messageIds.push(msg.info.id);
  }
  return { messageIds, messagesById };
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
