import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import type { StoredSession, StoredSessionSummary } from "../../src/types/desktop";

/**
 * App-side session transcript store.
 *
 * The bundled OpenCode `serve` engine keeps conversations in memory and never
 * flushes them to its on-disk session store in this app's setup, so chats are
 * lost on exit/restart. To make history durable, BloxMind mirrors every
 * session's messages to `userData/sessions` and rehydrates them on launch.
 *
 * Writes are debounced in the Main process (the Renderer never computes a path
 * — it only sends sessions over IPC). A pending queue is kept so an explicit
 * flush on quit can force every buffered write to disk, preventing data loss
 * from the debounce window.
 */

const SESSIONS_DIR = () => join(app.getPath("userData"), "sessions");
const INDEX_PATH = () => join(SESSIONS_DIR(), "index.json");
const LAST_ACTIVE_PATH = () => join(SESSIONS_DIR(), "last-active.json");

const STAGE_FLUSH_MS = 1000;

function sanitize(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe === "" ? "session" : safe;
}

const sessionPath = (id: string) => join(SESSIONS_DIR(), `${sanitize(id)}.json`);

async function ensureDir(): Promise<void> {
  await mkdir(SESSIONS_DIR(), { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Pending-write queue (flushed on quit) ─────────────────────────────────
const pending = new Map<string, StoredSession>();
let stageTimer: ReturnType<typeof setTimeout> | null = null;

// Serializes every index.json mutation (updateIndex / deleteSession /
// reconcileIndex) so concurrent read-modify-write cycles can never interleave
// and lose entries via last-writer-wins.
let indexMutation: Promise<void> = Promise.resolve();

function withIndexLock<T>(task: () => Promise<T>): Promise<T> {
  const run = indexMutation.then(task, task);
  // Keep the chain alive even if a task rejects; callers still get the error.
  indexMutation = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function scheduleStageFlush(): void {
  if (stageTimer) clearTimeout(stageTimer);
  stageTimer = setTimeout(() => {
    stageTimer = null;
    void flushPendingWrites();
  }, STAGE_FLUSH_MS);
  // Never keep the process alive solely for a buffered write — an explicit
  // flush on quit covers the shutdown path.
  stageTimer.unref?.();
}

/**
 * Stage a session for writing. The actual disk write is debounced; call
 * `flushPendingWrites` to force everything to disk immediately (e.g. on quit).
 */
export function stageSession(session: StoredSession): void {
  console.debug(
    `[SessionStore] stageSession: session=${session.id}, messageCount=${session.messages?.messageIds?.length ?? "undefined"}`,
  );
  pending.set(session.id, session);
  scheduleStageFlush();
}

/**
 * Force every staged session to disk and clear the queue. Safe to call often.
 *
 * Per-entry failure isolation: one corrupt/unwritable session must never
 * prevent the rest from being persisted, and the index must still be updated
 * with every session that *did* write — otherwise those sessions exist on
 * disk but vanish from the sidebar after a restart.
 */
export async function flushPendingWrites(): Promise<void> {
  console.debug(`[SessionStore] flushPendingWrites() — pending size: ${pending.size}`);
  if (stageTimer) {
    clearTimeout(stageTimer);
    stageTimer = null;
  }
  if (pending.size === 0) {
    console.debug("[SessionStore] flushPendingWrites — nothing pending, returning");
    return;
  }
  const entries = [...pending.values()];
  pending.clear();
  console.debug(
    `[SessionStore] flushing ${entries.length} session(s): ${entries.map((e) => e.id).join(", ")}`,
  );
  await ensureDir();
  // Write all session files concurrently (independent files — no collision).
  const results = await Promise.allSettled(entries.map((session) => writeSessionFile(session)));
  const written: StoredSession[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const result = results[i];
    if (result.status === "fulfilled") {
      written.push(entries[i]);
    } else {
      console.error(`[SessionStore] Failed to persist session ${entries[i].id}:`, result.reason);
    }
  }
  if (written.length === 0) return;
  await withIndexLock(() => updateIndex(written));
}

async function writeSessionFile(session: StoredSession): Promise<void> {
  await writeFile(sessionPath(session.id), JSON.stringify(session), "utf8");
}

/** Update (or create) index entries for every session in one atomic read-modify-write
 * cycle. Called after all session files have been written so concurrent flushes
 * can never clobber each other's index entries. */
async function updateIndex(sessions: StoredSession[]): Promise<void> {
  const index = await readJson<StoredSessionSummary[]>(INDEX_PATH(), []);
  const summaries: StoredSessionSummary[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.messageIds.length,
    metadata: session.metadata,
  }));
  const next = (Array.isArray(index) ? index : [])
    .filter((entry) => !summaries.some((s) => s.id === entry.id))
    .concat(summaries);
  await writeFile(INDEX_PATH(), JSON.stringify(next), "utf8");
}

export async function listSessions(): Promise<StoredSessionSummary[]> {
  let index = await readJson<StoredSessionSummary[]>(INDEX_PATH(), []);
  // Corrupt/missing index, or one that references fewer sessions than actually
  // exist on disk (e.g. an earlier crash prevented the index update), must not
  // hide history — rebuild the index from the physical directory.
  if (!Array.isArray(index) || (await indexLooksIncomplete(index))) {
    await reconcileIndex();
    index = await readJson<StoredSessionSummary[]>(INDEX_PATH(), []);
  }
  return [...(Array.isArray(index) ? index : [])].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** True when session files exist on disk that the index does not mention
 * (or vice versa) — i.e. the index no longer reflects the directory. */
async function indexLooksIncomplete(index: StoredSessionSummary[]): Promise<boolean> {
  try {
    const files = await readdir(SESSIONS_DIR());
    const fileIds = new Set(
      files
        .filter(
          (file) => file.endsWith(".json") && file !== "index.json" && file !== "last-active.json",
        )
        .map((file) => file.slice(0, -".json".length)),
    );
    if (fileIds.size === 0 && index.length === 0) return false;
    // A count check is not enough: the index may reference ids whose files no
    // longer exist while missing ids that do. Compare both directions using
    // the sanitised filename form of each indexed id.
    const indexedFiles = new Set(index.map((entry) => sanitize(entry.id)));
    if (indexedFiles.size !== fileIds.size) return true;
    for (const file of fileIds) {
      if (!indexedFiles.has(file)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function getSession(id: string): Promise<StoredSession | null> {
  return readJson<StoredSession | null>(sessionPath(id), null);
}

/** Write a session to disk immediately (no debounce). */
export async function saveSession(session: StoredSession): Promise<void> {
  await ensureDir();
  await writeSessionFile(session);
  await withIndexLock(() => updateIndex([session]));
}

export async function deleteSession(id: string): Promise<void> {
  // Drop any staged (debounced) write for this session FIRST. A staged save
  // would otherwise be flushed by the next debounce timer / quit flush a
  // moment later, resurrecting the file and index entry we just deleted.
  pending.delete(id);
  await rm(sessionPath(id), { force: true }).catch(() => undefined);
  // Also purge the session's isolated checkpoint storage (journal + git refs)
  // so no checkpoint/index data lingers after deletion. Each session's
  // checkpoints are already isolated at checkpoints/sessions/{sessionId}/
  const checkpointDir = join(app.getPath("userData"), "checkpoints", "sessions", sanitize(id));
  await rm(checkpointDir, { recursive: true, force: true }).catch(() => undefined);
  // Serialized with updateIndex so a concurrent flush can't re-add this
  // session's summary after we remove it (or drop ours via last-writer-wins).
  await withIndexLock(async () => {
    const index = await readJson<StoredSessionSummary[]>(INDEX_PATH(), []);
    const next = (Array.isArray(index) ? index : []).filter((s) => s.id !== id);
    await ensureDir();
    await writeFile(INDEX_PATH(), JSON.stringify(next), "utf8");
  });
}

export async function setLastActive(id: string | null): Promise<void> {
  await ensureDir();
  await writeFile(LAST_ACTIVE_PATH(), JSON.stringify({ id }), "utf8");
}

export async function getLastActive(): Promise<string | null> {
  const data = await readJson<{ id: string | null }>(LAST_ACTIVE_PATH(), { id: null });
  return data.id;
}

/**
 * Rebuild `index.json` from the session files physically present in
 * `userData/sessions`. Guarantees that a missing or corrupted index can never
 * make recovered sessions disappear from the sidebar.
 */
export async function reconcileIndex(): Promise<void> {
  console.debug("[SessionStore] reconcileIndex() — scanning files in", SESSIONS_DIR());
  await ensureDir();
  let files: string[] = [];
  try {
    files = await readdir(SESSIONS_DIR());
  } catch {
    console.debug("[SessionStore] reconcileIndex — could not read sessions dir");
    return;
  }
  const summaries: StoredSessionSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    if (file === "index.json" || file === "last-active.json") continue;
    const session = await readJson<StoredSession | null>(join(SESSIONS_DIR(), file), null);
    // Trust the on-disk session data itself as the source of truth for its id.
    // The old check (`session.id !== fileWithoutExtension`) was invalid because
    // the filename is the *sanitised* id (e.g. "abc/def" → "abc_def.json"),
    // so sessions with special characters in their id were silently skipped.
    if (!session?.id) {
      console.debug(`[SessionStore] reconcileIndex — skipping file ${file} (no id)`);
      continue;
    }
    console.debug(`[SessionStore] reconcileIndex — found session ${session.id} in file ${file}`);
    summaries.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.messageIds?.length ?? 0,
      metadata: session.metadata,
    });
  }
  console.debug(
    `[SessionStore] reconcileIndex — rebuilt index with ${summaries.length} session(s)`,
  );
  await writeFile(
    INDEX_PATH(),
    JSON.stringify(summaries.sort((a, b) => b.updatedAt - a.updatedAt)),
    "utf8",
  );
}
