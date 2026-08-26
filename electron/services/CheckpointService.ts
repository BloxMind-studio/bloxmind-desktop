import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { Context, Data, Effect, Layer, Schema } from "effect";

import {
  type CaptureContext,
  CaptureContextSchema,
  type Checkpoint,
  type CheckpointRestoreInput,
  CheckpointRestoreInputSchema,
  type CheckpointRestoreResult,
  CheckpointSchema,
  type FileChange,
  type RestorePreview,
  RestorePreviewSchema,
  type ValidationResult,
  ValidationResultSchema,
} from "../../src/types/checkpoints";
import { resolveGitBackend } from "./GitBackend";
import { RojoServerManagerTag, type RojoStatus } from "./RojoServerManager";

const exec = promisify(execFile);

/** Appended to the restore message when Rojo is active & connected to Studio. */
const LIVE_SYNCED_MESSAGE =
  " ✓ Reverted to Checkpoint [ID]. Code live-synced to Roblox Studio via Rojo!";

const MAX_JOURNAL_FILE_BYTES = 512 * 1024; // mirror raw content only for small files

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  message: string;
  cause?: unknown;
}> {}

export interface CheckpointServiceOptions {
  /** App-level storage root e.g. app.getPath("userData") + "/checkpoints" */
  storeRoot: string;
  /** The workspace root being edited (OpenCode workspace) */
  workspace: string;
}

export interface CheckpointService {
  readonly capture: (context: CaptureContext) => Effect.Effect<Checkpoint, CheckpointError>;
  readonly restore: (
    input: CheckpointRestoreInput,
  ) => Effect.Effect<CheckpointRestoreResult, CheckpointError, RojoServerManagerTag>;
  readonly preview: (
    checkpointId: string,
    sessionId: string,
  ) => Effect.Effect<RestorePreview, CheckpointError>;
  readonly list: (sessionId: string) => Effect.Effect<readonly Checkpoint[], CheckpointError>;
  readonly validate: () => Effect.Effect<ValidationResult, CheckpointError>;
  /** Delete all checkpoint data for a session (index, journals, git objects). Best-effort; never fails if storage is already absent. */
  readonly deleteSession: (sessionId: string) => Effect.Effect<void, CheckpointError>;
}

export class CheckpointServiceTag extends Context.Tag("@BloxMind/CheckpointService")<
  CheckpointServiceTag,
  CheckpointService
>() {}

// ── Helpers ─────────────────────────────────────────────────────────────

function isMissingFile(cause: unknown): boolean {
  return cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT";
}

function readJsonFile<A>(
  file: string,
  schema: Schema.Schema<A>,
  fallback: A,
): Effect.Effect<A, CheckpointError> {
  return Effect.gen(function* () {
    const contents = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(file, "utf8");
        } catch (cause) {
          if (isMissingFile(cause)) return null;
          throw cause;
        }
      },
      catch: (cause) => new CheckpointError({ message: `Failed to read ${file}`, cause }),
    });
    if (contents === null) return fallback;
    const parsed = yield* Effect.try({
      try: () => JSON.parse(contents) as unknown,
      catch: (cause) => new CheckpointError({ message: `Invalid JSON in ${file}`, cause }),
    });
    return yield* Schema.decodeUnknown(schema)(parsed).pipe(
      Effect.mapError(
        (cause) => new CheckpointError({ message: `Invalid checkpoint data: ${file}`, cause }),
      ),
    );
  });
}

function hashContent(contents: string): string {
  // Normalize line endings to LF so hashes are consistent across platforms and
  // git backends. System git with `core.autocrlf=true` (common on Windows)
  // normalizes CRLF↔LF when staging/checking out, which would otherwise make
  // the post-restore verification hash differ from the captured preHash even
  // though the textual content is identical.
  const normalized = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function readTextSafe(path: string): Promise<string | null> {
  return readFile(path, "utf8").then(
    (contents) => contents,
    () => null,
  );
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isSafeWorkspacePath(root: string, relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0")) return false;
  const normalized = toPosixPath(relativePath);
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  const candidate = resolve(root, relativePath);
  const relativeCandidate = toPosixPath(relative(root, candidate));
  return relativeCandidate !== ".." && !relativeCandidate.startsWith("../");
}

function validateWorkspacePaths(
  root: string,
  paths: readonly string[],
): Effect.Effect<void, CheckpointError> {
  for (const path of paths) {
    if (!isSafeWorkspacePath(root, path)) {
      return Effect.fail(new CheckpointError({ message: `Path escapes workspace: ${path}` }));
    }
  }
  return Effect.void;
}

// Directories and managed files that must never be journaled into a
// full-workspace snapshot (noise / derived artifacts or files the app
// itself rewrites on every launch, like AGENTS.md).
const SKIP_DIRS = new Set([
  ".git",
  ".opencode", // tool cache (e.g. rg.exe binaries) — not journalable without git
  "node_modules",
  "dist",
  "dist-electron",
  ".bloxmind",
  ".vite",
  "build",
  "coverage",
]);
const SKIP_FILES = new Set(["AGENTS.md"]);

/** Recursively list every file in the workspace root (POSIX-relative). */
function listWorkspaceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable / missing directories are skipped
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;
        results.push(toPosixPath(relative(root, full)));
      }
    }
  }
  return walk(root).then(() => results);
}

// ── Index persistence ───────────────────────────────────────────────────

function sessionIndexPath(storeRoot: string, sessionId: string): string {
  return join(storeRoot, "sessions", sanitize(sessionId), "checkpoints.json");
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

interface SessionIndex {
  history: Checkpoint[];
  activeIndex: number;
}

const SessionIndexSchema = Schema.mutable(
  Schema.Struct({
    history: Schema.Array(CheckpointSchema),
    activeIndex: Schema.Number,
  }),
);

const EMPTY_INDEX: SessionIndex = { history: [], activeIndex: -1 };

function loadSessionIndex(storeRoot: string, sessionId: string) {
  return readJsonFile(sessionIndexPath(storeRoot, sessionId), SessionIndexSchema, EMPTY_INDEX).pipe(
    Effect.catchAll((error) => {
      // Self-heal: indices written by older broken builds (empty journal,
      // no git ref) are useless — drop them so fresh captures/restores work.
      console.warn(`[checkpoint] ignoring invalid session index: ${error.message}`);
      return Effect.succeed(EMPTY_INDEX);
    }),
    Effect.map((index) => ({
      history: index.history.map((c) => ({
        ...c,
        fullSnapshot: c.fullSnapshot ?? false,
      })),
      activeIndex: index.activeIndex,
    })),
  );
}

// Serializes index writes to disk so concurrent capture/restore requests
// never race on the same checkpoints.json (Windows `rename` fails with EPERM
// when the destination is briefly locked by another write).
const storeMutex = Effect.unsafeMakeSemaphore(1);

// Per-session mutexes protect the read-modify-write cycle of capture/restore
// so concurrent operations on the same session can't lose checkpoints.
const sessionMutexes = new Map<string, Effect.Semaphore>();
function getSessionMutex(sessionId: string): Effect.Semaphore {
  let mutex = sessionMutexes.get(sessionId);
  if (!mutex) {
    mutex = Effect.unsafeMakeSemaphore(1);
    sessionMutexes.set(sessionId, mutex);
  }
  return mutex;
}
function withSessionLock<A, E>(
  sessionId: string,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  const mutex = getSessionMutex(sessionId);
  return mutex.withPermits(1)(effect);
}

async function writeJsonAtomicImpl(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    try {
      await rename(temporary, file);
    } catch {
      // On Windows, `rename` can transiently fail with EPERM/EEXIST when the
      // destination is open. Fall back to copying the temp into place, which
      // overwrites the destination and is still effectively atomic for the
      // single-file index. Re-throw only if the fallback also fails.
      await copyFile(temporary, file).catch(async (copyCause) => {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw copyCause;
      });
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

function writeJsonAtomic(file: string, value: unknown): Effect.Effect<void, CheckpointError> {
  return Effect.tryPromise({
    try: () => writeJsonAtomicImpl(file, value),
    catch: (cause) => new CheckpointError({ message: `Failed to write ${file}`, cause }),
  }).pipe(storeMutex.withPermits(1));
}

function persistSessionIndex(
  storeRoot: string,
  sessionId: string,
  index: SessionIndex,
): Effect.Effect<void, CheckpointError> {
  const file = sessionIndexPath(storeRoot, sessionId);
  return Effect.tryPromise({
    try: () => mkdir(dirname(file), { recursive: true }),
    catch: (cause) => new CheckpointError({ message: "Failed to create store", cause }),
  }).pipe(Effect.flatMap(() => writeJsonAtomic(file, index)));
}

// ── Capture / restore core ──────────────────────────────────────────────

/**
 * Enumerate the files git reports as actually modified/staged/untracked.
 * NEVER throws: if the git probe fails (e.g. the embedded backend on an
 * unborn HEAD) it degrades to an empty set so the capture still persists —
 * a rejected capture would leave the checkpoint list empty and permanently
 * hide the UI badge and Restore button.
 */
async function enumerateChangedPaths(workspace: string): Promise<string[]> {
  try {
    const backend = await resolveGitBackend();
    if (!(await backend.isGitRepo(workspace))) return [];
    return (await backend.getChangedFiles(workspace))
      .map(toPosixPath)
      .filter((p) => !SKIP_FILES.has(p));
  } catch {
    return [];
  }
}

/** Journal the pre-state of one path so it can be restored without a git ref. */
function captureJournalChange(
  workspace: string,
  relPath: string,
): Effect.Effect<FileChange, CheckpointError> {
  return Effect.gen(function* () {
    const absPath = resolve(workspace, relPath);
    const contents = yield* Effect.tryPromise({
      try: () => readTextSafe(absPath),
      catch: (cause) => new CheckpointError({ message: `Failed to read ${relPath}`, cause }),
    });
    if (contents === null) {
      // Path does not exist yet — restoring means deleting it.
      return { path: relPath, operation: "create", preHash: hashContent(""), preContent: null };
    }
    return {
      path: relPath,
      operation: "modify",
      preHash: hashContent(contents),
      // Mirror raw content only for small files; large/binary content is
      // reconstructed from the git snapshot instead.
      preContent: Buffer.byteLength(contents, "utf8") <= MAX_JOURNAL_FILE_BYTES ? contents : null,
    };
  });
}

/**
 * Create the git-backed workspace snapshot (system git preferred, embedded
 * isomorphic-git fallback). Returns `null` — never throws — when no snapshot
 * is possible, letting restore degrade to the journal safely.
 */
async function createGitSnapshotRef(workspace: string): Promise<string | null> {
  try {
    const backend = await resolveGitBackend();
    if (!(await backend.isGitRepo(workspace))) return null;
    try {
      // Unborn HEAD: stash-based snapshots need a base commit to exist.
      await backend.ensureBaseline(workspace);
    } catch {
      return null;
    }
    return await backend.snapshot(workspace, `bloxmind:${randomBytes(6).toString("hex")}`);
  } catch {
    return null;
  }
}

function makeCapture(
  options: CheckpointServiceOptions,
): (context: CaptureContext) => Effect.Effect<Checkpoint, CheckpointError> {
  return (context) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(CaptureContextSchema)(context).pipe(
        Effect.mapError(
          (cause) => new CheckpointError({ message: "Invalid capture context", cause }),
        ),
      );
      const sessionId = decoded.sessionId;
      yield* validateWorkspacePaths(options.workspace, decoded.paths);

      // 1. Capture pre-state for every scoped path (journal fallback).
      //    A capture without explicit paths IS the full pre-task snapshot
      //    (fullSnapshot=true): its gitRef reconstructs the entire workspace,
      //    while the journal only mirrors the dirty set so legacy committed
      //    files (.gitkeep, old scripts) are never pulled into checkpoints.
      //    Explicit-path captures remain task-scoped (fullSnapshot=false).
      const isPreTaskSnapshot = decoded.paths.length === 0;
      const targetPaths = isPreTaskSnapshot
        ? yield* Effect.promise(() => enumerateChangedPaths(options.workspace))
        : decoded.paths.map(toPosixPath);
      const fullSnapshot = isPreTaskSnapshot;
      const changes: FileChange[] = [];
      for (const relPath of targetPaths) {
        changes.push(yield* captureJournalChange(options.workspace, relPath));
      }

      // 2. Git-backed snapshot covering the whole workspace (tracked AND
      //    untracked files — staged first via `git add -A` inside the backend).
      //    `git stash create` needs an existing base commit, which the backend
      //    ensures; a clean worktree falls back to a dangling tree-commit so
      //    pre-task captures always produce a restorable ref.
      const gitRef = yield* Effect.promise(() => createGitSnapshotRef(options.workspace));
      if (gitRef === null) {
        yield* Effect.logWarning(
          "[checkpoint] git snapshot unavailable (no system git and embedded backend failed); restore is journal-only",
        );
      }

      // 3. Persist index (DAG: parent = activeIndex).
      //    Locked per-session so concurrent captures can't read the same base
      //    index and overwrite each other's appended checkpoint.
      const checkpoint = yield* withSessionLock(
        sessionId,
        Effect.gen(function* () {
          const index = yield* loadSessionIndex(options.storeRoot, sessionId);
          const cp: Checkpoint = {
            id: `cp_${randomBytes(8).toString("hex")}`,
            parentId: index.history[index.activeIndex]?.id ?? null,
            timestamp: Date.now(),
            sessionId,
            messageId: decoded.messageId,
            kind: "pre-exec",
            tool: decoded.tool,
            paths: changes,
            gitRef,
            failureLog: null,
            fullSnapshot,
          };
          const next = [...index.history, cp];
          yield* persistSessionIndex(options.storeRoot, sessionId, {
            history: next,
            activeIndex: next.length - 1,
          });
          return cp;
        }),
      );

      yield* Effect.logInfo(
        `[checkpoint] captured ${checkpoint.id} session=${sessionId} paths=${changes.length} gitRef=${gitRef ?? "none"}`,
      );
      return checkpoint;
    });
}

function restoreFromJournal(
  options: CheckpointServiceOptions,
  checkpoint: Checkpoint,
): Effect.Effect<void, CheckpointError> {
  return Effect.gen(function* () {
    for (const change of checkpoint.paths) {
      if (SKIP_FILES.has(change.path)) continue;
      const absPath = resolve(options.workspace, change.path);
      if (change.operation === "create") {
        yield* Effect.tryPromise({
          try: () => rm(absPath, { force: true }),
          catch: (cause) =>
            new CheckpointError({ message: `Failed to remove ${change.path}`, cause }),
        });
      } else if (change.preContent !== null) {
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(dirname(absPath), { recursive: true });
            const temporary = `${absPath}.${process.pid}.restore.tmp`;
            try {
              await writeFile(temporary, change.preContent ?? "", { mode: 0o600 });
              try {
                await rename(temporary, absPath);
              } catch {
                await copyFile(temporary, absPath);
              }
            } finally {
              await rm(temporary, { force: true }).catch(() => undefined);
            }
          },
          catch: (cause) =>
            new CheckpointError({ message: `Failed to restore ${change.path}`, cause }),
        });
      } else if (change.operation === "modify") {
        // Large/binary file that exceeded the journal size limit and no git
        // snapshot is available — it can't be reconstructed byte-for-byte.
        // Leave the current file untouched so the rest of the workspace
        // still restores cleanly.
        console.warn(`[checkpoint] skipping binary/large file (no git ref): ${change.path}`);
      } else {
        yield* Effect.fail(
          new CheckpointError({
            message: `No journal content for ${change.path} and no git ref available`,
          }),
        );
      }
    }
  });
}

/**
 * After an explicit full-workspace rollback, delete any file under the
 * workspace root that was NOT present in the captured git snapshot. This is a
 * precise diff between the snapshot tree (`gitRef`) and the current disk
 * state: only agent-created post-capture files are removed, so unmodified
 * baseline project files, settings/time values, and legacy committed files —
 * which ARE in the snapshot — are never touched. Guaranteed-safe: only files
 * outside SKIP_DIRS are candidates, and it runs solely when the caller
 * explicitly opted out of preserveUserEdits (a destructive, user-requested
 * rewind). Best-effort per file — a failure never aborts the whole restore.
 */
function removeFilesCreatedAfterGitCheckpoint(
  workspace: string,
  gitRef: string,
): Effect.Effect<void, CheckpointError> {
  return Effect.tryPromise({
    try: async () => {
      const backend = await resolveGitBackend();
      const snapshotSet = new Set(
        (await backend.listFiles(workspace, gitRef)).map((p) => toPosixPath(p)),
      );
      const allFiles = await listWorkspaceFiles(workspace);
      for (const relPath of allFiles) {
        if (snapshotSet.has(relPath)) continue;
        const absPath = resolve(workspace, relPath);
        await rm(absPath, { force: true });
      }
      return undefined;
    },
    catch: (cause) =>
      new CheckpointError({
        message: "Failed to remove post-checkpoint files during restore",
        cause,
      }),
  });
}

function makeRestore(
  options: CheckpointServiceOptions,
): (
  input: CheckpointRestoreInput,
) => Effect.Effect<CheckpointRestoreResult, CheckpointError, RojoServerManagerTag> {
  return (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(CheckpointRestoreInputSchema)(input).pipe(
        Effect.mapError(
          (cause) => new CheckpointError({ message: "Invalid restore input", cause }),
        ),
      );
      // Read index under per-session lock so concurrent captures can't append
      // between our read and the later cursor update.
      const { checkpoint } = yield* withSessionLock(
        decoded.sessionId,
        Effect.gen(function* () {
          const idx = yield* loadSessionIndex(options.storeRoot, decoded.sessionId);
          const cp = idx.history.find((c) => c.id === decoded.checkpointId);
          if (!cp) {
            return yield* Effect.fail(
              new CheckpointError({ message: `No checkpoint ${decoded.checkpointId}` }),
            );
          }
          return { checkpoint: cp };
        }),
      );
      const scopedPaths = checkpoint.paths.map((c) => toPosixPath(c.path)).filter((p) => !SKIP_FILES.has(p));
      yield* validateWorkspacePaths(options.workspace, scopedPaths);
      // A checkpoint captured with no explicit paths (full pre-task snapshot)
      // restores tracked files from its gitRef, while journal data restores
      // small/untracked files without deleting unrelated files.
      const restorePaths = scopedPaths.length > 0 ? scopedPaths : ["."];

      if (decoded.dryRun) {
        return {
          restoredId: checkpoint.id,
          message: checkpoint.fullSnapshot
            ? `Would restore entire workspace (${checkpoint.paths.length} file(s) tracked)`
            : `Would restore ${checkpoint.paths.length} file(s)`,
          filesChanged: restorePaths,
          rojoSynced: false,
        };
      }

      // A full snapshot has no reliable way to distinguish an agent edit
      // from a concurrent user edit. Refuse the destructive operation when
      // callers explicitly request preservation instead of risking loss.
      if (decoded.preserveUserEdits && checkpoint.fullSnapshot) {
        return yield* Effect.fail(
          new CheckpointError({
            message:
              "Safe restore refused for a full-workspace checkpoint while preserveUserEdits is enabled",
          }),
        );
      }

      // Narrow once so the guarded gitRef flows through without casts.
      const snapshotRef = checkpoint.gitRef;

      if (snapshotRef) {
        // Restore tracked files from the snapshot, but never run `git clean`.
        // Uses the same backend the capture used (system git or embedded
        // isomorphic-git). Falls back to the journal on failure.
        yield* Effect.tryPromise({
          try: async () => {
            const backend = await resolveGitBackend();
            await backend.restore(options.workspace, snapshotRef, restorePaths);
            return undefined;
          },
          catch: (error) =>
            new Error(
              error instanceof Error ? error.message : String(error),
            ),
        }).pipe(
          Effect.catchAll((error) =>
            restoreFromJournal(options, checkpoint).pipe(
              Effect.catchAll(() =>
                Effect.fail(
                  new CheckpointError({
                    message: `Git restore failed (${error.message}) and journal fallback also failed`,
                  }),
                ),
              ),
            ),
          ),
        );
      } else {
        yield* restoreFromJournal(options, checkpoint);
        // No gitRef → no diff base exists, so agent-created files cannot be
        // identified safely and are left on disk; the prune step below is
        // gitRef-gated for exactly this reason.
      }

      // Explicit rollback on a full-workspace snapshot: diff the current
      // workspace against the captured git tree and remove files the agent
      // created after the snapshot (they aren't in it, so a plain checkout
      // leaves them behind and Rojo would re-push them to Studio).
      // Only for non-preserving restores (the user explicitly asked to rewind).
      if (checkpoint.fullSnapshot && !decoded.preserveUserEdits && snapshotRef) {
        yield* removeFilesCreatedAfterGitCheckpoint(options.workspace, snapshotRef);
      }

      // Atomicity: verify restored hashes match pre-state exactly. Entries
      // that were left untouched (large binaries with no git ref) are skipped.
      // Skip managed/legacy-excluded files (e.g. AGENTS.md) for backward compat
      // with old checkpoints that included them — they are no longer captured.
      for (const change of checkpoint.paths) {
        if (SKIP_FILES.has(change.path)) continue;
        if (change.preContent === null && change.operation === "modify") continue;
        const absPath = resolve(options.workspace, change.path);
        const after = yield* Effect.tryPromise({
          try: () => readTextSafe(absPath),
          catch: (cause) =>
            new CheckpointError({ message: `Failed to verify ${change.path}`, cause }),
        });
        if (change.operation === "create") {
          if (after !== null) {
            yield* Effect.fail(
              new CheckpointError({
                message: `Restore verification failed: ${change.path} should not exist`,
              }),
            );
          }
        } else if (after === null || hashContent(after) !== change.preHash) {
          yield* Effect.fail(
            new CheckpointError({
              message: `Restore verification failed for ${change.path}: hash mismatch`,
            }),
          );
        }
      }

      // Move history cursor to the restored checkpoint under lock so a
      // concurrent capture can't change the index between our read and write.
      yield* withSessionLock(
        decoded.sessionId,
        Effect.gen(function* () {
          const currentIndex = yield* loadSessionIndex(options.storeRoot, decoded.sessionId);
          const nextIndex = currentIndex.history.findIndex((c) => c.id === checkpoint.id);
          yield* persistSessionIndex(options.storeRoot, decoded.sessionId, {
            ...currentIndex,
            activeIndex: nextIndex,
          });
        }),
      );

      yield* Effect.logInfo(
        `[checkpoint] restored ${checkpoint.id} session=${decoded.sessionId} files=${scopedPaths.length}`,
      );

      // ── Rojo live-sync push ───────────────────────────────────────────
      // The restored files live in the unified ~/BloxMind workspace that the
      // global `rojo serve` watches. Touch default.project.json so the
      // watcher re-scans and pushes the reverted tree into Roblox Studio
      // immediately, then poll for a short window while Rojo detects the
      // change and the plugin reconnects.
      yield* RojoServerManagerTag.notifyRestored().pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
      const ROJO_SYNC_POLL_INTERVAL_MS = 250;
      const ROJO_SYNC_POLL_MAX_ATTEMPTS = 12; // 12 × 250ms = 3s max
      let rojoSynced = false;
      let rojoStatus: RojoStatus | null = null;
      for (let attempt = 0; attempt < ROJO_SYNC_POLL_MAX_ATTEMPTS; attempt++) {
        rojoStatus = yield* RojoServerManagerTag.status().pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        );
        if (rojoStatus?.active === true && rojoStatus.clientConnected === true) {
          rojoSynced = true;
          break;
        }
        // If the server isn't active at all, no point polling further.
        if (rojoStatus?.active !== true) break;
        yield* Effect.sleep(`${ROJO_SYNC_POLL_INTERVAL_MS} millis`);
      }
      const baseMessage = checkpoint.fullSnapshot
        ? `Restored entire workspace (${checkpoint.paths.length} file(s) tracked)`
        : `Restored ${checkpoint.paths.length} file(s)`;
      const message = rojoSynced
        ? `${baseMessage}${LIVE_SYNCED_MESSAGE.replace("[ID]", checkpoint.id)}`
        : rojoStatus?.active === true
          ? `${baseMessage} (Rojo server active on port ${rojoStatus.port ?? 34872} — connect Studio to see changes)`
          : baseMessage;

      return {
        restoredId: checkpoint.id,
        message,
        filesChanged: restorePaths,
        rojoSynced,
      };
    });
}

function makePreview(
  options: CheckpointServiceOptions,
): (checkpointId: string, sessionId: string) => Effect.Effect<RestorePreview, CheckpointError> {
  return (checkpointId, sessionId) =>
    Effect.gen(function* () {
      const index = yield* loadSessionIndex(options.storeRoot, sessionId);
      const checkpoint = index.history.find((c) => c.id === checkpointId);
      if (!checkpoint) {
        return yield* Effect.fail(
          new CheckpointError({ message: `No checkpoint ${checkpointId}` }),
        );
      }
      yield* validateWorkspacePaths(
        options.workspace,
        checkpoint.paths.map((c) => c.path),
      );
      const segments = checkpoint.paths.map((c) => ({ path: c.path, operation: c.operation }));
      return yield* Schema.decodeUnknown(RestorePreviewSchema)({
        segments,
        restoredId: checkpoint.id,
        message: checkpoint.fullSnapshot
          ? `Entire workspace snapshot — ${checkpoint.paths.length} file(s) tracked`
          : `${checkpoint.paths.length} file(s) will be restored`,
      }).pipe(
        Effect.mapError((cause) => new CheckpointError({ message: "Invalid preview", cause })),
      );
    });
}

function makeList(
  options: CheckpointServiceOptions,
): (sessionId: string) => Effect.Effect<readonly Checkpoint[], CheckpointError> {
  return (sessionId) =>
    loadSessionIndex(options.storeRoot, sessionId).pipe(Effect.map((index) => index.history));
}

// ── Session cleanup ──────────────────────────────────────────────────────

/**
 * Purge all on-disk checkpoint data for a session: the journal index
 * (checkpoints/sessions/{sessionId}/checkpoints.json) and the entire
 * session-isolated directory (git objects, journals, metadata).
 * Best-effort — missing directories are silently OK. Never throws for a
 * session that has no stored data.
 */
function makeDeleteSession(
  options: CheckpointServiceOptions,
): (sessionId: string) => Effect.Effect<void, CheckpointError> {
  return (sessionId) =>
    Effect.tryPromise({
      try: async () => {
        const sessionDir = join(options.storeRoot, "sessions", sanitize(sessionId));
        await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      },
      catch: (cause) =>
        new CheckpointError({
          message: `Failed to delete session storage for ${sessionId}`,
          cause,
        }),
    }).pipe(Effect.catchAll(() => Effect.void));
}

// ── Validation gates ────────────────────────────────────────────────────

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Effect.Effect<string, CheckpointError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await exec(command, args, {
        cwd,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      return `${result.stdout}\n${result.stderr}`.trim();
    },
    catch: (cause) =>
      new CheckpointError({
        message:
          cause instanceof Error && "stdout" in cause
            ? String(cause.stdout)
            : cause instanceof Error
              ? cause.message
              : String(cause),
        cause,
      }),
  });
}

const isNodeProject = (workspace: string): Effect.Effect<boolean, CheckpointError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await access(join(workspace, "package.json"));
        return true;
      } catch {
        return false;
      }
    },
    catch: (cause) => new CheckpointError({ message: "Failed to probe workspace", cause }),
  });

const makeValidate =
  (options: CheckpointServiceOptions) => (): Effect.Effect<ValidationResult, CheckpointError> =>
    Effect.gen(function* () {
      // Only gate Node/TypeScript projects. For non-Node workspaces (plain
      // folders, game projects, etc.) there is nothing to lint/type-check/test,
      // so validation passes trivially instead of spuriously failing.
      const nodeProject = yield* isNodeProject(options.workspace);
      if (!nodeProject) {
        return yield* Schema.decodeUnknown(ValidationResultSchema)({
          ok: true,
          fastGatePassed: true,
          fullGatePassed: true,
          logs: "",
        }).pipe(
          Effect.mapError((cause) => new CheckpointError({ message: "Invalid validation", cause })),
        );
      }

      // Fast gate: quick blocking syntax/AST check (< 1s).
      const fastGate = yield* runCommand(
        "npx",
        ["biome", "check", "--only=syntax", "."],
        options.workspace,
        15_000,
      ).pipe(
        Effect.map((log) => ({ ok: true, log })),
        Effect.catchAll((error) => Effect.succeed({ ok: false, log: error.message })),
      );

      if (!fastGate.ok) {
        return yield* Schema.decodeUnknown(ValidationResultSchema)({
          ok: false,
          fastGatePassed: false,
          fullGatePassed: false,
          logs: fastGate.log,
        }).pipe(
          Effect.mapError((cause) => new CheckpointError({ message: "Invalid validation", cause })),
        );
      }

      // Full gate: type-check + unit tests (2–15s, run sequentially).
      const fullGate = yield* Effect.all(
        [
          runCommand("npx", ["tsc", "--noEmit"], options.workspace, 120_000).pipe(
            Effect.map(() => ({ ok: true, log: "" })),
            Effect.catchAll((error) => Effect.succeed({ ok: false, log: error.message })),
          ),
          runCommand("npx", ["vitest", "run"], options.workspace, 120_000).pipe(
            Effect.map(() => ({ ok: true, log: "" })),
            Effect.catchAll((error) => Effect.succeed({ ok: false, log: error.message })),
          ),
        ],
        { concurrency: 1 },
      );

      return yield* Schema.decodeUnknown(ValidationResultSchema)({
        ok: fastGate.ok && fullGate.every((r) => r.ok),
        fastGatePassed: fastGate.ok,
        fullGatePassed: fullGate.every((r) => r.ok),
        logs: fullGate
          .filter((r) => !r.ok)
          .map((r) => r.log)
          .join("\n"),
      }).pipe(
        Effect.mapError((cause) => new CheckpointError({ message: "Invalid validation", cause })),
      );
    });

// ── Layer ───────────────────────────────────────────────────────────────

export function makeCheckpointServiceLayer(options: CheckpointServiceOptions) {
  return Layer.effect(
    CheckpointServiceTag,
    Effect.gen(function* () {
      // Require the Rojo server manager so its live-sync status is available
      // to the restore handler. The matching `makeRojoServerManagerLayer` is
      // provided in the same runtime (main.ts).
      yield* RojoServerManagerTag;
      return {
        capture: makeCapture(options),
        restore: makeRestore(options),
        preview: makePreview(options),
        list: makeList(options),
        validate: makeValidate(options),
        deleteSession: makeDeleteSession(options),
      };
    }),
  );
}
