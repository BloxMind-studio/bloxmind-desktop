import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDirs: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => userDataDirs[0],
  },
}));

import {
  deleteSession,
  flushPendingWrites,
  getSession,
  listSessions,
  saveSession,
  stageSession,
} from "../../electron/services/SessionStore";
import type { StoredSession } from "../types/desktop";

function makeSession(id: string, messageCount = 1): StoredSession {
  return {
    id,
    title: `Title ${id}`,
    createdAt: 1000,
    updatedAt: 2000,
    messages: {
      messageIds: Array.from({ length: messageCount }, (_, i) => `msg_${i}`),
      messagesById: {},
    },
  };
}

async function seedDisk(id: string, session: StoredSession): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(userDataDirs[0], "sessions"), { recursive: true });
  await writeFile(join(userDataDirs[0], "sessions", `${id}.json`), JSON.stringify(session), "utf8");
}

beforeEach(async () => {
  userDataDirs.push(await mkdtemp(join(tmpdir(), "bloxmind-sessions-")));
});

afterEach(async () => {
  const dir = userDataDirs.pop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("lists sessions that exist only on disk with a healthy index", async () => {
    await seedDisk("ses_a", makeSession("ses_a"));
    await seedDisk("ses_b", makeSession("ses_b"));
    await writeFile(
      join(userDataDirs[0], "sessions", "index.json"),
      JSON.stringify([
        { id: "ses_a", title: "Title ses_a", createdAt: 1000, updatedAt: 2000, messageCount: 1 },
        { id: "ses_b", title: "Title ses_b", createdAt: 1000, updatedAt: 2000, messageCount: 1 },
      ]),
      "utf8",
    );

    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining(["ses_b", "ses_a"]));
  });

  it("recovers sessions missing from a stale non-empty index", async () => {
    await seedDisk("ses_a", makeSession("ses_a"));
    // Index only knows about an older session that no longer has a file.
    await writeFile(
      join(userDataDirs[0], "sessions", "index.json"),
      JSON.stringify([{ id: "ses_old", title: null, createdAt: 0, updatedAt: 0, messageCount: 0 }]),
      "utf8",
    );

    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toContain("ses_a");
  });

  it("stage + flush persists the file and updates the index", async () => {
    stageSession(makeSession("ses_x"));
    await flushPendingWrites();

    const stored = await getSession("ses_x");
    expect(stored?.id).toBe("ses_x");
    const index = JSON.parse(
      await readFile(join(userDataDirs[0], "sessions", "index.json"), "utf8"),
    );
    expect(index.map((s: { id: string }) => s.id)).toContain("ses_x");
  });

  it("a corrupt staged write does not drop other sessions or their index entries", async () => {
    const good = makeSession("ses_good");
    const bad = makeSession("ses_bad");
    // Force one write to fail by making its path a directory.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(userDataDirs[0], "sessions"), { recursive: true });
    await mkdir(join(userDataDirs[0], "sessions", `${bad.id}.json`));

    stageSession(good);
    stageSession(bad);
    await expect(flushPendingWrites()).resolves.toBeUndefined();

    expect(await getSession(good.id)).not.toBeNull();
    const index = JSON.parse(
      await readFile(join(userDataDirs[0], "sessions", "index.json"), "utf8"),
    );
    expect(index.map((s: { id: string }) => s.id)).toEqual([good.id]);
  });

  it("saveSession writes through even while a debounced flush is pending", async () => {
    stageSession(makeSession("ses_staged"));
    await saveSession(makeSession("ses_saved"));
    await flushPendingWrites();

    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).toContain("ses_staged");
    expect(ids).toContain("ses_saved");
  });

  it("deleteSession removes a staged (not yet flushed) session permanently", async () => {
    // A write is staged but NOT yet flushed to disk.
    stageSession(makeSession("ses_staged_delete"));
    // Delete it before the debounce flush would have run.
    await deleteSession("ses_staged_delete");
    // Force the pending flush now — must NOT resurrect the deleted session.
    await flushPendingWrites();

    expect(await getSession("ses_staged_delete")).toBeNull();
    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).not.toContain("ses_staged_delete");
  });

  it("deleteSession removes the summary without resurrecting via concurrent flushes", async () => {
    await saveSession(makeSession("ses_gone"));
    stageSession(makeSession("ses_keep"));
    await deleteSession("ses_gone");
    await flushPendingWrites();

    const ids = (await listSessions()).map((s) => s.id);
    expect(ids).not.toContain("ses_gone");
    expect(ids).toContain("ses_keep");
  });
});
