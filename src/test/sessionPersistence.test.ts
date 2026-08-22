import type { Session } from "@opencode-ai/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";
import { mergeMessagesLocalFirst } from "@/hooks/useMessages";
import { fetchSessionList, localSummaryToSession } from "@/hooks/useSessions";
import type { MessageWithParts } from "@/types";
import type { StoredSessionSummary } from "@/types/desktop";

vi.mock("@/lib/desktop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop")>();
  return {
    ...actual,
    desktop: {
      ...actual.desktop,
      sessionStoreList: vi.fn(),
      sessionStoreGet: vi.fn(),
    },
  };
});

// eslint-disable-next-line import/order
import { desktop } from "@/lib/desktop";

const msg = (id: string, text: string): MessageWithParts => ({
  info: { id, role: "user", time: new Date().toISOString() } as unknown as MessageWithParts["info"],
  parts: [{ type: "text", text } as MessageWithParts["parts"][number]],
});

const textOf = (message: MessageWithParts): string =>
  (message.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text ?? "";

function makeClient(engineSessions: Session[]) {
  return {
    v2: { session: { list: vi.fn(async () => ({ data: [] as unknown[] })) } },
    session: { list: vi.fn(async () => ({ data: engineSessions })) },
  } as unknown as Parameters<typeof fetchSessionList>[0];
}

describe("mergeMessagesLocalFirst", () => {
  it("keeps local history, overlays engine content, and appends new engine messages", () => {
    const local = {
      messageIds: ["h1", "h2"],
      messagesById: { h1: msg("h1", "old1"), h2: msg("h2", "stale") },
    };
    const engine = [msg("h2", "fresh"), msg("e1", "new")];

    const merged = mergeMessagesLocalFirst(local, engine);

    expect(merged.messageIds).toEqual(["h1", "h2", "e1"]);
    expect(textOf(merged.messagesById.h2)).toBe("fresh"); // engine wins
    expect(textOf(merged.messagesById.h1)).toBe("old1"); // history preserved
    expect(textOf(merged.messagesById.e1)).toBe("new");
  });

  it("returns engine-only content when there is no local history", () => {
    const merged = mergeMessagesLocalFirst(null, [msg("e1", "x")]);
    expect(merged.messageIds).toEqual(["e1"]);
  });
});

describe("localSummaryToSession", () => {
  it("maps the stored summary to a visible Session with second-based time", () => {
    const summary: StoredSessionSummary = {
      id: "ses_abc",
      title: "My chat",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      messageCount: 3,
    };
    const session = localSummaryToSession(summary) as unknown as Session;
    expect(session.id).toBe("ses_abc");
    expect(session.title).toBe("My chat");
    expect(session.time.created).toBe(1_700_000_000);
    expect((session.metadata as { BloxMindPersisted?: boolean }).BloxMindPersisted).toBe(true);
  });
});

describe("fetchSessionList local merge", () => {
  it("re-adds sessions that only survive in the local transcript store", async () => {
    const summary: StoredSessionSummary = {
      id: "ses_persisted",
      title: "Recovered chat",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      messageCount: 2,
    };
    (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([summary]);

    const result = await fetchSessionList(makeClient([]));

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ses_persisted");
    expect(result[0].title).toBe("Recovered chat");
  });

  it("prefers the engine session over a duplicate local entry", async () => {
    const engineSession = {
      id: "ses_shared",
      title: "Engine title",
      time: { created: 1_700_000_000, updated: 1_700_000_000 },
      metadata: {},
    } as unknown as Session;
    const summary: StoredSessionSummary = {
      id: "ses_shared",
      title: "Local title",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      messageCount: 2,
    };
    (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([summary]);

    const result = await fetchSessionList(makeClient([engineSession]));

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Engine title");
  });
});
