import type { Session } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import type { StoredSession } from "@/types/desktop";

const SAVE_DEBOUNCE_MS = 500;
const LIST_SENTINEL = "__list__";

/**
 * Persists every session's transcript to BloxMind's own store (under the app's
 * userData) so conversations survive the engine's in-memory-only lifecycle.
 *
 * It watches the React Query cache for any change to a session's messages or
 * metadata and debounces a save per session. The save reads the latest cache
 * and mirrors it through the desktop bridge; empty sessions are skipped so we
 * don't litter the store with blanks. This is desktop-only — in a browser
 * preview the bridge is absent and the hook is a no-op.
 */
export function useSessionPersistence(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined" || !window.BloxMind) {
      console.debug(
        "[useSessionPersistence] window.BloxMind is undefined — hook is a no-op (browser preview?)",
      );
      return;
    }

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // Sessions with a pending (debounced) save, so we can flush them on unload.
    const dirty = new Set<string>();

    const flushNow = () => {
      console.debug("[useSessionPersistence] flushNow() called — dirty:", [...dirty]);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const ids = [...dirty];
      dirty.clear();
      for (const id of ids) void persistSession(queryClient, id);
    };

    const schedule = (id: string) => {
      dirty.add(id);
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          dirty.delete(id);
          console.debug(`[useSessionPersistence] debounce fired for session ${id}`);
          void persistSession(queryClient, id);
        }, SAVE_DEBOUNCE_MS),
      );
    };
    const scheduleAll = () => {
      const sessions = queryClient.getQueryData<Session[]>(qk.sessions) ?? [];
      console.debug(`[useSessionPersistence] scheduleAll — sessions in cache: ${sessions.length}`);
      for (const session of sessions) schedule(session.id);
    };

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const id = sessionIdFromKey(event.query.queryKey);
      console.debug(
        `[useSessionPersistence] cache subscription event: type=${event.type}, key=${JSON.stringify(event.query.queryKey)}, extractedId=${id}`,
      );
      if (id === LIST_SENTINEL) scheduleAll();
      else if (id) schedule(id);
    });

    // On unload (app quit / window close) push any buffered writes to the Main
    // process immediately so the debounce window can't drop the last changes.
    const onPageHide = () => {
      console.debug("[useSessionPersistence] beforeunload/pagehide fired");
      flushNow();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      console.debug("[useSessionPersistence] cleanup — unsubscribing");
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      flushNow();
    };
  }, [queryClient]);
}

function sessionIdFromKey(key: readonly unknown[]): string | null {
  if (!Array.isArray(key) || key[0] !== "sessions") return null;
  if (key.length === 3 && key[2] === "messages") return key[1] as string;
  if (key.length === 2) return key[1] as string;
  if (key.length === 1) return LIST_SENTINEL;
  return null;
}

async function persistSession(queryClient: QueryClient, id: string): Promise<void> {
  const messages = queryClient.getQueryData<MessagesCache>(qk.messages(id));
  console.debug(
    `[persistSession] session=${id}, messageIds=${messages?.messageIds.length ?? "undefined"}, messagesById keys=${messages ? Object.keys(messages.messagesById).length : "undefined"}`,
  );
  if (!messages || messages.messageIds.length === 0) {
    console.debug(`[persistSession] SKIPPING session ${id} — no messages in cache`);
    return;
  }

  const meta = readSessionMeta(queryClient, id);
  const stored: StoredSession = {
    id,
    title: meta.title,
    createdAt: meta.createdAt || Date.now(),
    updatedAt: Date.now(),
    messages: { messageIds: messages.messageIds, messagesById: messages.messagesById },
    metadata: meta.metadata,
  };
  console.debug(
    `[persistSession] calling desktop.sessionStoreSave for session ${id}, messageCount=${stored.messages.messageIds.length}`,
  );
  try {
    await desktop.sessionStoreSave(stored);
    console.debug(`[persistSession] session ${id} saved successfully`);
  } catch (e) {
    console.error(`[persistSession] FAILED to save session ${id}:`, e);
    throw e;
  }
}

function readSessionMeta(
  queryClient: QueryClient,
  id: string,
): { title: string | null; createdAt: number; metadata?: Record<string, unknown> } {
  const fromList = queryClient
    .getQueryData<Session[]>(qk.sessions)
    ?.find((session) => session.id === id);
  if (fromList) {
    return {
      title: fromList.title ?? null,
      createdAt: (fromList.time?.created ?? 0) * 1000,
      metadata: fromList.metadata,
    };
  }
  const fromOne = queryClient.getQueryData<Session>(qk.session(id));
  if (fromOne) {
    return {
      title: fromOne.title ?? null,
      createdAt: (fromOne.time?.created ?? 0) * 1000,
      metadata: fromOne.metadata,
    };
  }
  return { title: null, createdAt: 0, metadata: undefined };
}
