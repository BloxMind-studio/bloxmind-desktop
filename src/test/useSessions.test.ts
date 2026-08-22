import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSessionList } from "@/hooks/useSessions";

vi.mock("@/lib/desktop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop")>();
  return {
    ...actual,
    desktop: {
      ...actual.desktop,
      sessionStoreList: vi.fn(),
    },
  };
});

// eslint-disable-next-line import/order
import { desktop } from "@/lib/desktop";

beforeEach(() => {
  (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

type ListClient = Parameters<typeof fetchSessionList>[0];

function makeSession(id: string, createdAt: number, hidden = false) {
  return {
    id,
    title: id,
    projectID: "proj",
    directory: "/workspace",
    time: { created: createdAt, updated: createdAt },
    version: "1",
    parentID: null,
    metadata: hidden ? { BloxMindHidden: true } : {},
  };
}

function makeClient(v1: unknown[] | Error, v2: unknown[] | Error): ListClient {
  const respond = async <T>(value: T | Error): Promise<{ data?: T }> => {
    if (value instanceof Error) throw value;
    return { data: value };
  };
  return {
    session: {
      list: () => respond(v1 as never),
    },
    v2: {
      session: {
        list: () => respond(v2 as never),
      },
    },
  } as unknown as ListClient;
}

describe("fetchSessionList", () => {
  it("includes isolated v2 sessions that the v1 listing omits", async () => {
    const plain = makeSession("ses_plain", 1);
    const isolated = makeSession("ses_isolated", 2);
    const client = makeClient([plain], [{ ...isolated }]);

    const result = await fetchSessionList(client);

    expect(result.map((s) => s.id)).toEqual(["ses_isolated", "ses_plain"]);
  });

  it("prefers the v1 shape so hidden sessions stay filtered", async () => {
    const hidden = makeSession("ses_hidden", 3, true);
    const visible = makeSession("ses_visible", 4);
    const client = makeClient([hidden, visible], [{ ...hidden }]);

    const result = await fetchSessionList(client);

    expect(result.map((s) => s.id)).toEqual(["ses_visible"]);
  });

  it("still returns sessions when only one listing source answers", async () => {
    const client = makeClient(new Error("v1 down"), [makeSession("ses_only_v2", 5)]);
    expect((await fetchSessionList(client)).map((s) => s.id)).toEqual(["ses_only_v2"]);

    const other = makeClient([makeSession("ses_only_v1", 6)], new Error("v2 down"));
    expect((await fetchSessionList(other)).map((s) => s.id)).toEqual(["ses_only_v1"]);
  });

  it("falls back to an empty list (not a wipe) when every listing source fails and no local store exists", async () => {
    (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const client = makeClient(new Error("boom"), new Error("boom"));
    await expect(fetchSessionList(client)).resolves.toEqual([]);
  });

  it("recovers sessions from the local store when the engine is unavailable", async () => {
    (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ses_local", title: "Recovered", createdAt: 1000, updatedAt: 2000, messageCount: 3 },
    ]);
    const client = makeClient(new Error("boom"), new Error("boom"));
    expect((await fetchSessionList(client)).map((s) => s.id)).toEqual(["ses_local"]);
  });

  it("still shows saved sessions even when the client lacks a usable listing surface", async () => {
    (desktop.sessionStoreList as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ses_local_a", title: "A", createdAt: 1000, updatedAt: 2000, messageCount: 2 },
      { id: "ses_local_b", title: "B", createdAt: 900, updatedAt: 1900, messageCount: 1 },
    ]);
    // .v2 and .session both missing — the old code threw here before reading local.
    const client = { v2: undefined, session: undefined } as unknown as ListClient;

    const result = await fetchSessionList(client);
    expect(result.map((s) => s.id)).toEqual(["ses_local_a", "ses_local_b"]);
  });

  it("sorts newest first", async () => {
    const older = makeSession("ses_old", 10);
    const newer = makeSession("ses_new", 20);
    const client = makeClient([older, newer], []);

    expect((await fetchSessionList(client)).map((s) => s.id)).toEqual(["ses_new", "ses_old"]);
  });
});
