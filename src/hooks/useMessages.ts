import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { MessageWithParts } from "@/types";

const NOOP_KEY = ["__noop__"] as const;
const EMPTY_IDS: string[] = [];
const EMPTY_CACHE: MessagesCache = { messageIds: [], messagesById: {} };

async function fetchMessages(client: OpencodeClient, sessionID: string): Promise<MessagesCache> {
  const res = await client.session.messages({ sessionID });
  if (!res.data) return EMPTY_CACHE;
  const messageIds: string[] = [];
  const messagesById: Record<string, MessageWithParts> = {};
  for (const msg of res.data) {
    messageIds.push(msg.info.id);
    messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
  }
  return { messageIds, messagesById };
}

export function useMessageIds(): string[] {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  const { data } = useQuery<MessagesCache, Error, string[]>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () => fetchMessages(client!, activeSessionId!),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messageIds, []),
  });
  return data ?? EMPTY_IDS;
}

export function useMessage(messageId: string): MessageWithParts | undefined {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  return useQuery<MessagesCache, Error, MessageWithParts | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () => fetchMessages(client!, activeSessionId!),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messagesById[messageId], [messageId]),
  }).data;
}
