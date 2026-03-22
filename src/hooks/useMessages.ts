import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import type { MessageWithParts } from "@/types";

const EMPTY_IDS: string[] = [];

export function useMessageIds(): string[] {
  const { activeSessionId } = useActiveSession();
  const { data } = useQuery<MessagesCache, Error, string[]>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["__noop__"],
    enabled: !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messageIds, []),
  });
  return data ?? EMPTY_IDS;
}

export function useMessage(messageId: string): MessageWithParts | undefined {
  const { activeSessionId } = useActiveSession();
  return useQuery<MessagesCache, Error, MessageWithParts | undefined>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : ["__noop__"],
    enabled: !!activeSessionId,
    select: useCallback((d: MessagesCache) => d.messagesById[messageId], [messageId]),
  }).data;
}
