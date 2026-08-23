import type { Session } from "@opencode-ai/sdk/v2/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import { isVisibleSession } from "@/lib/sessionVisibility";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { StoredSessionSummary } from "@/types/desktop";

/**
 * The engine's v1 session.list omits sessions created through the v2 API with
 * an isolated workspace directory (exactly how the app creates chat sessions),
 * so a v1-only refetch used to make active chats vanish mid-conversation. The
 * unscoped v2 list sees every session: seed with it, then overlay the v1
 * result which carries the metadata the visibility filter needs.
 *
 * The bundled engine does not persist conversations to disk, so BloxMind also
 * mirrors every session to its own store. Sessions that only exist in that local
 * store (because the engine dropped them on restart) are re-added here so the
 * sidebar still shows the user's history.
 */
export async function fetchSessionList(
  client: {
    session: {
      list(
        input: Record<string, never>,
        options?: { throwOnError?: boolean },
      ): Promise<{ data?: Session[] }>;
    };
    v2: {
      session: {
        list?(
          input: Record<string, never>,
          options?: { throwOnError?: boolean },
        ): Promise<{ data?: unknown }>;
      };
    };
  },
  previous?: Session[],
): Promise<Session[]> {
  const byId = new Map<string, Session>();
  // Set when either engine listing REJECTS. A rejection means we only have a
  // partial picture — folding in the previous cache below stops a transient
  // failure from dropping live sessions (which used to close the active chat
  // the moment a fresh, never-messaged session was omitted from one pass).
  let engineListingsFailed = false;

  console.debug(
    `[fetchSessionList] window.BloxMind=${typeof window !== "undefined" && !!window.BloxMind}, ` +
      `client.v2?.session?.list=${typeof client?.v2?.session?.list}, client.session?.list=${typeof client?.session?.list}`,
  );

  // Engine listing is best-effort only. Each source is guarded by
  // `Promise.allSettled` (so neither can throw) and the whole block runs
  // inside a try/catch, so a client whose `.v2`/`.session` surface is missing
  // can never prevent the local-store read below from running.
  try {
    const v2List = client?.v2?.session?.list;
    const v1List = client?.session?.list;
    const settled = await Promise.allSettled([
      v2List ? v2List({}, { throwOnError: true }) : Promise.resolve({ data: [] }),
      v1List ? v1List({}, { throwOnError: true }) : Promise.resolve({ data: [] }),
    ]);
    if (settled.some((outcome) => outcome.status === "rejected")) {
      engineListingsFailed = true;
      console.warn("[fetchSessionList] an engine listing source rejected; merging previous cache");
    }
    const v2 =
      settled[0].status === "fulfilled"
        ? ((settled[0].value as { data?: unknown } | undefined)?.data as
            | Array<Record<string, unknown>>
            | undefined)
        : [];
    const v1 =
      settled[1].status === "fulfilled"
        ? ((settled[1].value as { data?: unknown } | undefined)?.data as
            | Array<Record<string, unknown>>
            | undefined)
        : [];
    for (const item of v2 ?? []) {
      const itemId = (item as { id?: unknown })?.id;
      if (typeof itemId !== "string") continue;
      byId.set(itemId, item as unknown as Session);
    }
    // Overlay v1 last: it carries the metadata the visibility filter needs.
    for (const session of v1 ?? []) {
      const sessionId = (session as { id?: unknown })?.id;
      if (typeof sessionId !== "string") continue;
      byId.set(sessionId, session as unknown as Session);
    }
  } catch (error) {
    console.error("[fetchSessionList] engine listing threw:", error);
    engineListingsFailed = true;
  }

  // ── Hard safety net ─────────────────────────────────────────────────────
  // The local transcript store is the durable source of the user's history.
  // It is ALWAYS read and ALWAYS folded into the result (for ids the engine
  // doesn't already provide), so a transient engine/listing failure can never
  // make saved conversations disappear from the sidebar.
  let localCount = -1;
  try {
    const local = await desktop.sessionStoreList();
    localCount = local?.length ?? 0;
    console.debug(`[fetchSessionList] local store returned ${localCount} summary(s)`);
    for (const summary of local ?? []) {
      if (!summary?.id) continue;
      if (byId.has(summary.id)) continue;
      byId.set(summary.id, localSummaryToSession(summary));
    }
  } catch (error) {
    console.error("[fetchSessionList] sessionStoreList() rejected:", error);
  }

  // A failed/partial engine pass must never drop sessions the UI already
  // knows about. Union the previous cache (hidden ones stay filtered below);
  // genuine deletions are safe because the delete flows mutate this same
  // cache before the next fetch runs.
  if (engineListingsFailed && previous) {
    for (const session of previous) {
      if (!session?.id || byId.has(session.id)) continue;
      if (!isVisibleSession(session)) continue;
      byId.set(session.id, session);
    }
  }

  const result = [...byId.values()]
    .filter(isVisibleSession)
    .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
  console.debug(
    `[fetchSessionList] returning ${result.length} session(s), byId=${byId.size}, localCount=${localCount}`,
  );
  return result;
}

export function localSummaryToSession(summary: StoredSessionSummary): Session {
  return {
    id: summary.id,
    title: summary.title ?? "Untitled session",
    time: {
      created: Math.floor(summary.createdAt / 1000),
      updated: Math.floor(summary.updatedAt / 1000),
    },
    metadata: { ...(summary.metadata ?? {}), BloxMindPersisted: true },
  } as unknown as Session;
}

export function useSessions() {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<Session[]>({
    queryKey: qk.sessions,
    queryFn: () =>
      client
        ? fetchSessionList(client, queryClient.getQueryData<Session[]>(qk.sessions))
        : Promise.resolve([]),
    enabled: ready && !!client,
    // Watchdog poll (see useSessionStatuses for rationale): the session list is
    // normally kept fresh by SSE invalidation, but a dropped or reconnecting
    // stream could otherwise leave it stale silently. A slow poll reconciles it.
    refetchInterval: 30_000,
  });
}
