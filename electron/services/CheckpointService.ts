import { exec, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { Context, Data, Effect, Layer, Schema } from "effect";

import {
  type CaptureContext,
  CaptureContextSchema,
  type Checkpoint,
  CheckpointSchema,
  type CheckpointRestoreInput,
  CheckpointRestoreInputSchema,
  type CheckpointRestoreResult,
  type FileChange,
  type RestorePreview,
  RestorePreviewSchema,
  type ValidationResult,
  ValidationResultSchema,
} from "../../src/types/checkpoints";

const execFileAsync = promisify(execFile);
const execShellAsync = promisify(exec);

const MAX_JOURNAL_FILE_BYTES = 512 * 1024; // mirror raw content only for small files
/**
 * Checkpoints retained per session. Long sessions used to grow the index (and
 * every rewrite of it) without bound; older entries are dropped once the cap is
 * passed, and their pre-image blobs are collected when nothing else uses them.
 */
const DEFAULT_MAX_HISTORY_ENTRIES = 100;
/**
 * Unreferenced blobs younger than this may belong to a capture in flight in
 * this or another process, so garbage collection leaves them alone.
 */
const DEFAULT_BLOB_GC_MIN_AGE_MS = 60 * 60 * 1000;

export class CheckpointError extends Data.TaggedError("CheckpointError")<{
  message: string;
  cause?: unknown;
}> {}

export interface CheckpointServiceOptions {
  /** App-level storage root e.g. app.getPath("userData") + "/checkpoints" */
  storeRoot: string;
  /** The workspace root being edited (OpenCode workspace) */
  workspace: string;
  /** Checkpoints kept per session before the oldest are trimmed. */
  maxHistory?: number;
  /** Minimum age before an unreferenced pre-image blob may be collected. */
  blobGcMinAgeMs?: number;
}

export interface CheckpointService {
  readonly capture: (context: CaptureContext) => Effect.Effect<Checkpoint, CheckpointError>;
  readonly restore: (
    input: CheckpointRestoreInput,
  ) => Effect.Effect<CheckpointRestoreResult, CheckpointError>;
  readonly preview: (
    checkpointId: string,
    sessionId: string,
  ) => Effect.Effect<RestorePreview, CheckpointError>;
  readonly list: (sessionId: string) => Effect.Effect<readonly Checkpoint[], CheckpointError>;
  readonly validate: () => Effect.Effect<ValidationResult, CheckpointError>;
}

export class CheckpointServiceTag extends Context.Tag("@BloxMind/CheckpointService")<
  CheckpointServiceTag,
  CheckpointService
>() {}

// ── Helpers ─────────────────────────────────────────────────────────────

function isMissingFile(cause: unknown): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

function readJsonFile<A, I>(
  file: string,
  // Encoded may differ from decoded: `optionalWith(..., { default })` accepts
  // records written before the field existed and fills it in on decode.
  schema: Schema.Schema<A, I>,
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

function hashBytes(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** sha256 of a string's UTF-8 bytes. */
function hashContent(contents: string): string {
  return hashBytes(Buffer.from(contents, "utf8"));
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The text of a file that is valid UTF-8 without NUL bytes, or null when the
 * file is binary. Journaling binaries as decoded text silently replaced every
 * invalid byte with U+FFFD, so a restore corrupted images, audio and .rbxl
 * files while still reporting a successful hash check.
 */
function textFromBytes(contents: Buffer): string | null {
  if (contents.includes(0)) return null;
  try {
    return strictUtf8.decode(contents);
  } catch {
    return null;
  }
}

function readBytesSafe(path: string): Promise<Buffer | null> {
  return readFile(path).then(
    (contents) => contents,
    (cause) => {
      // Only a genuinely missing file counts as "absent". Any other error
      // (permissions, locked file, EISDIR) must surface: treating it as
      // "missing" during capture journaled a phantom "create" entry, and a
      // later restore would happily delete the real file.
      if (isMissingFile(cause)) return null;
      throw cause;
    },
  );
}

// ── Pre-image blob store ────────────────────────────────────────────────
// Pre-images are stored outside the session index: the index keeps one hash
// per changed file and identical content is stored once. The index used to
// carry every byte inline, so each capture rewrote the whole history as JSON
// and the cost grew with the square of the session length.

/** sha256 hex — the only shape a blob reference may take. */
const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/;

function blobPath(storeRoot: string, hash: string): string {
  return join(storeRoot, "blobs", hash);
}

async function writeBlobImpl(storeRoot: string, hash: string, contents: Buffer): Promise<void> {
  const directory = join(storeRoot, "blobs");
  await mkdir(directory, { recursive: true });
  const file = blobPath(storeRoot, hash);
  try {
    await access(file);
    return; // content-addressed: the existing blob is byte-identical
  } catch {
    // fall through and write it
  }
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    try {
      await rename(temporary, file);
    } catch {
      // Windows rename can fail when the destination is open; copying is
      // still atomic for content-addressed data because both writers hold
      // the same bytes.
      await copyFile(temporary, file);
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function writeBlob(
  storeRoot: string,
  hash: string,
  contents: Buffer,
): Effect.Effect<void, CheckpointError> {
  return Effect.tryPromise({
    try: () => writeBlobImpl(storeRoot, hash, contents),
    catch: (cause) => new CheckpointError({ message: `Failed to store pre-image ${hash}`, cause }),
  });
}

function readBlob(
  storeRoot: string,
  hash: string,
): Effect.Effect<Buffer | null, CheckpointError> {
  // A malformed reference can only come from a corrupted index; refusing it
  // keeps it from being resolved as a path outside the blob directory.
  if (!BLOB_HASH_PATTERN.test(hash)) {
    return Effect.fail(new CheckpointError({ message: `Invalid pre-image reference: ${hash}` }));
  }
  return Effect.tryPromise({
    try: () => readBytesSafe(blobPath(storeRoot, hash)),
    catch: (cause) => new CheckpointError({ message: `Failed to read pre-image ${hash}`, cause }),
  });
}

/** The bytes recorded for a change, from the blob store or a legacy inline payload. */
function preImageFor(
  storeRoot: string,
  change: FileChange,
): Effect.Effect<Buffer | null, CheckpointError> {
  if (change.preBlob !== null) {
    return readBlob(storeRoot, change.preBlob);
  }
  if (change.preContent !== null) {
    return Effect.succeed(
      Buffer.from(
        change.preContent,
        change.preEncoding === "base64" ? "base64" : "utf8",
      ),
    );
  }
  return Effect.succeed(null);
}

/** Whether a change carries (or points at) a restorable pre-image. */
function hasJournalPayload(change: FileChange): boolean {
  return change.preBlob !== null || change.preContent !== null;
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

// Directories that must never be journaled into a full-workspace snapshot
// (noise / derived artifacts only).
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
        results.push(toPosixPath(relative(root, full)));
      }
    }
  }
  return walk(root).then(() => results);
}

// ── Git helpers ─────────────────────────────────────────────────────────

function git(args: string[], cwd: string): Effect.Effect<string, CheckpointError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await execFileAsync("git", args, {
        cwd,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
      return result.stdout;
    },
    catch: (cause) => new CheckpointError({ message: `git ${args[0]} failed`, cause }),
  });
}

function isGitRepo(workspace: string): Effect.Effect<boolean, CheckpointError> {
  return git(["rev-parse", "--is-inside-work-tree"], workspace).pipe(
    Effect.map((out) => out.trim() === "true"),
    Effect.catchAll(() => Effect.succeed(false)),
  );
}

/**
 * Workspace-relative paths that differ from HEAD: modifications, deletions and
 * every untracked file.
 *
 * `git status` reports repo-root-relative paths, so a workspace nested inside a
 * larger repository is rebased onto `--show-prefix` (otherwise the capture would
 * resolve paths outside the workspace). `git status` has no `--relative`.
 */
function workspaceStatusPaths(workspace: string): Effect.Effect<string[], CheckpointError> {
  return Effect.gen(function* () {
    const prefix = (yield* git(["rev-parse", "--show-prefix"], workspace)).trim();
    const stdout = yield* git(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      workspace,
    );
    const paths = parseGitStatusPaths(stdout);
    if (!prefix) return paths;
    return paths
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length));
  });
}

/** Parse NUL-delimited `git status --porcelain=v1 -z` output into paths. */
export function parseGitStatusPaths(stdout: string): string[] {
  const fields = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry) continue;
    // Format: `XY <path>`. Renames and copies append the original path as the
    // next field; journal it too so a restore can delete a file the agent
    // recreated at a path that was empty at snapshot time.
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (path) paths.push(path);
    if (status.includes("R") || status.includes("C")) {
      const original = fields[index + 1];
      if (original) paths.push(original);
      index += 1;
    }
  }
  return [...new Set(paths)];
}

function listWorkspaceFilesEffect(workspace: string): Effect.Effect<string[], CheckpointError> {
  return Effect.tryPromise({
    try: () => listWorkspaceFiles(workspace),
    catch: (cause) => new CheckpointError({ message: "Failed to enumerate workspace", cause }),
  });
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

// Serializes whole index operations per session (load → modify → persist) so
// concurrent capture/restore requests never race on the same checkpoints.json
// (e.g. a restore writing back a stale history would drop a checkpoint that a
// concurrent capture just appended). Note: this mutex must wrap operations,
// not individual writes — acquiring it inside writeJsonAtomic while a caller
// already holds it would deadlock.
const storeMutex = Effect.unsafeMakeSemaphore(1);

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
  });
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

/**
 * Delete pre-image blobs that no session index references any more.
 *
 * Blobs are content-addressed and shared across sessions, so the only safe way
 * to know whether one is still needed is to scan every index. That is
 * expensive, so it runs only after a history trim (rare) and only removes
 * files older than `blobGcMinAgeMs`: a capture writes its blobs before the
 * index that references them, and a concurrent process may be doing the same.
 */
function collectOrphanBlobs(
  options: CheckpointServiceOptions,
): Effect.Effect<number, CheckpointError> {
  return Effect.tryPromise({
    try: async () => {
      const blobsDirectory = join(options.storeRoot, "blobs");
      let names: string[];
      try {
        names = await readdir(blobsDirectory);
      } catch (cause) {
        if (isMissingFile(cause)) return 0;
        throw cause;
      }

      const referenced = new Set<string>();
      const sessionsRoot = join(options.storeRoot, "sessions");
      let sessionDirectories: string[];
      try {
        sessionDirectories = await readdir(sessionsRoot);
      } catch (cause) {
        if (isMissingFile(cause)) sessionDirectories = [];
        else throw cause;
      }
      for (const directory of sessionDirectories) {
        try {
          const contents = await readFile(
            join(sessionsRoot, directory, "checkpoints.json"),
            "utf8",
          );
          const parsed = JSON.parse(contents) as {
            history?: Array<{ paths?: Array<{ preBlob?: unknown }> }>;
          };
          for (const checkpoint of parsed.history ?? []) {
            for (const change of checkpoint.paths ?? []) {
              if (typeof change.preBlob === "string") referenced.add(change.preBlob);
            }
          }
        } catch {
          // An unreadable index may still reference its blobs; the age check
          // below keeps everything recent, so skipping it is safe.
        }
      }

      const cutoff = Date.now() - (options.blobGcMinAgeMs ?? DEFAULT_BLOB_GC_MIN_AGE_MS);
      let removed = 0;
      for (const name of names) {
        if (referenced.has(name) || !BLOB_HASH_PATTERN.test(name)) continue;
        try {
          const stats = await stat(join(blobsDirectory, name));
          if (stats.mtimeMs > cutoff) continue;
          await rm(join(blobsDirectory, name), { force: true });
          removed += 1;
        } catch {
          // Already gone or locked; a later trim retries.
        }
      }
      return removed;
    },
    catch: (cause) => new CheckpointError({ message: "Failed to clean up pre-images", cause }),
  });
}

// ── Capture / restore core ──────────────────────────────────────────────

function makeCapture(
  options: CheckpointServiceOptions,
): (context: CaptureContext) => Effect.Effect<Checkpoint, CheckpointError> {
  // Sessions whose whole workspace has already been journaled by this process.
  // The first capture of a session must be a full snapshot (it is the fallback
  // when git cannot restore a file); later turns only journal what git status
  // reports as changed, which keeps large workspaces cheap.
  const snapshottedSessions = new Set<string>();

  return (context) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(CaptureContextSchema)(context).pipe(
        Effect.mapError(
          (cause) => new CheckpointError({ message: "Invalid capture context", cause }),
        ),
      );
      const sessionId = decoded.sessionId;
      yield* validateWorkspacePaths(options.workspace, decoded.paths);

      // 1. Decide the capture scope and journal the pre-state of every path in
      //    it. A non-git workspace has no cheap change list, so it always gets
      //    a full walk; a git workspace gets one full walk per session and
      //    `git status` afterwards.
      const repoBacked = yield* isGitRepo(options.workspace);
      let fullSnapshot = false;
      let targetPaths: string[];
      if (decoded.paths.length > 0) {
        targetPaths = decoded.paths.map(toPosixPath);
      } else if (!repoBacked || !snapshottedSessions.has(sessionId)) {
        fullSnapshot = true;
        targetPaths = yield* listWorkspaceFilesEffect(options.workspace);
      } else {
        const status = yield* workspaceStatusPaths(options.workspace).pipe(
          Effect.map((paths) => ({ listed: true, paths })),
          Effect.catchAll((error) => {
            // A failing status must not silently narrow the snapshot: fall
            // back to the safe (slow) full walk instead.
            console.warn(
              `[checkpoint] git status failed, taking a full snapshot: ${error.message}`,
            );
            return Effect.succeed({ listed: false, paths: [] });
          }),
        );
        if (status.listed) {
          targetPaths = status.paths;
        } else {
          fullSnapshot = true;
          targetPaths = yield* listWorkspaceFilesEffect(options.workspace);
        }
      }

      const changes: FileChange[] = [];
      for (const relPath of targetPaths) {
        const absPath = resolve(options.workspace, relPath);
        const contents = yield* Effect.tryPromise({
          try: () => readBytesSafe(absPath),
          catch: (cause) => new CheckpointError({ message: `Failed to read ${relPath}`, cause }),
        }).pipe(
          // A file that can't be read right now (locked by Studio, permissions,
          // special file) is left out of the journal instead of failing the
          // whole capture — and it is never journaled as a phantom "create",
          // which a later restore would have to interpret as "delete it".
          Effect.catchAll((error) => {
            console.warn(`[checkpoint] skipping unreadable file ${relPath}: ${error.message}`);
            return Effect.succeed<Buffer | null | undefined>(undefined);
          }),
        );
        if (contents === undefined) continue;
        if (contents === null) {
          changes.push({
            path: relPath,
            operation: "create",
            preHash: hashContent(""),
            preContent: null,
            preBlob: null,
            preEncoding: "utf8",
          });
        } else {
          const preHash = hashBytes(contents);
          const withinLimit = contents.byteLength <= MAX_JOURNAL_FILE_BYTES;
          // Store the bytes before the index references them: a failure here
          // must fail the capture rather than leave an unrestorable entry.
          if (withinLimit) yield* writeBlob(options.storeRoot, preHash, contents);
          const text = textFromBytes(contents);
          changes.push({
            path: relPath,
            operation: "modify",
            preHash,
            preContent: null,
            // Oversized files are skipped and reported as such instead of
            // pretending to be restored.
            preBlob: withinLimit ? preHash : null,
            preEncoding: text === null ? "base64" : "utf8",
          });
        }
      }

      // 2. Git-backed snapshot for tracked files. Untracked files are kept in
      // the journal above; `git stash create` cannot safely include them.
      const gitRef = repoBacked
        ? yield* git(
            ["stash", "create", `bloxmind:${randomBytes(6).toString("hex")}`],
            options.workspace,
          ).pipe(
            Effect.map((out) => out.trim() || null),
            Effect.catchAll(() => Effect.succeed<string | null>(null)),
          )
        : null;

      // 3. Persist index (DAG: parent = activeIndex). The load-modify-persist
      //    cycle runs under the store mutex so a concurrent restore can't
      //    write the history back from a stale copy and silently drop this
      //    checkpoint.
      const checkpoint = yield* storeMutex.withPermits(1)(
        Effect.gen(function* () {
          const index = yield* loadSessionIndex(options.storeRoot, sessionId);
          const captured: Checkpoint = {
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
          const next = [...index.history, captured];
          // Cap the history so the index rewrite and the settings list stay
          // bounded over a long session. The active index always points at the
          // checkpoint just captured, which stays in the retained tail.
          const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY_ENTRIES);
          const overflow = Math.max(0, next.length - maxHistory);
          const history = overflow > 0 ? next.slice(overflow) : next;
          yield* persistSessionIndex(options.storeRoot, sessionId, {
            history,
            activeIndex: history.length - 1,
          });
          return { captured, trimmed: overflow > 0 };
        }),
      );

      // Only mark the session after the snapshot is safely persisted, so a
      // failed capture never downgrades the next attempt to a scoped one.
      if (fullSnapshot) snapshottedSessions.add(sessionId);

      if (checkpoint.trimmed) {
        yield* collectOrphanBlobs(options).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`[checkpoint] pre-image cleanup failed: ${error.message}`),
          ),
        );
      }

      yield* Effect.logInfo(
        `[checkpoint] captured ${checkpoint.captured.id} session=${sessionId} paths=${changes.length} gitRef=${gitRef ?? "none"} full=${fullSnapshot}`,
      );
      return checkpoint.captured;
    });
}

function restoreFromJournal(
  options: CheckpointServiceOptions,
  checkpoint: Checkpoint,
): Effect.Effect<void, CheckpointError> {
  return Effect.gen(function* () {
    for (const change of checkpoint.paths) {
      const absPath = resolve(options.workspace, change.path);
      if (change.operation === "create") {
        yield* Effect.tryPromise({
          try: () => rm(absPath, { force: true }),
          catch: (cause) => new CheckpointError({ message: `Failed to remove ${change.path}`, cause }),
        });
        continue;
      }

      // New checkpoints point at a blob; checkpoints written by older builds
      // carry the payload inline. Both restore the exact recorded bytes.
      const payload = yield* preImageFor(options.storeRoot, change);
      if (payload === null) {
        // A referenced blob that cannot be read is corruption, not a file that
        // was intentionally skipped: fail instead of silently leaving the
        // agent's edit in place.
        if (change.preBlob !== null) {
          return yield* Effect.fail(
            new CheckpointError({ message: `Pre-image for ${change.path} is missing` }),
          );
        }
        if (change.operation === "modify") {
          // Large file that exceeded the journal size limit and no git
          // snapshot is available — it can't be reconstructed
          // byte-for-byte. Leave the current file untouched so the rest of
          // the workspace still restores cleanly.
          console.warn(`[checkpoint] skipping binary/large file (no git ref): ${change.path}`);
        } else {
          yield* Effect.fail(
            new CheckpointError({
              message: `No journal content for ${change.path} and no git ref available`,
            }),
          );
        }
        continue;
      }

      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(absPath), { recursive: true });
          const temporary = `${absPath}.${process.pid}.restore.tmp`;
          try {
            await writeFile(temporary, payload, { mode: 0o600 });
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
    }
  });
}

function restoreImpl(
  options: CheckpointServiceOptions,
  input: CheckpointRestoreInput,
): Effect.Effect<CheckpointRestoreResult, CheckpointError> {
  return Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(CheckpointRestoreInputSchema)(input).pipe(
        Effect.mapError(
          (cause) => new CheckpointError({ message: "Invalid restore input", cause }),
        ),
      );
      const index = yield* loadSessionIndex(options.storeRoot, decoded.sessionId);
      const checkpoint = index.history.find((c) => c.id === decoded.checkpointId);
      if (!checkpoint) {
        return yield* Effect.fail(
          new CheckpointError({ message: `No checkpoint ${decoded.checkpointId}` }),
        );
      }
      const scopedPaths = checkpoint.paths.map((c) => toPosixPath(c.path));
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

      if (checkpoint.gitRef) {
        // Restore tracked files from the snapshot, but never run `git clean`.
        // `git stash create` does not preserve untracked files, so cleaning
        // here would permanently delete unrelated user files.
        yield* git(["checkout", checkpoint.gitRef, "--", ...restorePaths], options.workspace).pipe(
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
        // Files created after a full snapshot are intentionally left alone:
        // without an untracked-file-aware snapshot, deleting them is unsafe.
      }

      // Atomicity: verify restored hashes match pre-state exactly. Entries
      // that were left untouched (large binaries with no git ref) are skipped.
      for (const change of checkpoint.paths) {
        if (!hasJournalPayload(change) && change.operation === "modify") continue;
        const absPath = resolve(options.workspace, change.path);
        const after = yield* Effect.tryPromise({
          try: () => readBytesSafe(absPath),
          catch: (cause) => new CheckpointError({ message: `Failed to verify ${change.path}`, cause }),
        });
        if (change.operation === "create") {
          if (after !== null) {
            yield* Effect.fail(
              new CheckpointError({
                message: `Restore verification failed: ${change.path} should not exist`,
              }),
            );
          }
        } else if (after === null || hashBytes(after) !== change.preHash) {
          yield* Effect.fail(
            new CheckpointError({
              message: `Restore verification failed for ${change.path}: hash mismatch`,
            }),
          );
        }
      }

      // Move history cursor to the restored checkpoint.
      const nextIndex = index.history.findIndex((c) => c.id === checkpoint.id);
      yield* persistSessionIndex(options.storeRoot, decoded.sessionId, {
        ...index,
        activeIndex: nextIndex,
      });

      yield* Effect.logInfo(
        `[checkpoint] restored ${checkpoint.id} session=${decoded.sessionId} files=${scopedPaths.length}`,
      );

      // Files with no journal payload are deliberately left untouched, so say
      // so instead of claiming the whole workspace came back.
      const skipped =
        checkpoint.gitRef === null
          ? checkpoint.paths.filter(
              (change) => change.operation === "modify" && !hasJournalPayload(change),
            ).length
          : 0;
      const skippedNote =
        skipped > 0 ? `; ${skipped} file(s) too large to journal were left untouched` : "";
      const message = checkpoint.fullSnapshot
        ? `Restored entire workspace (${checkpoint.paths.length} file(s) tracked${skippedNote})`
        : `Restored ${checkpoint.paths.length} file(s)${skippedNote}`;

      return {
        restoredId: checkpoint.id,
        message,
        filesChanged: restorePaths,
      };
    });
}

function makeRestore(
  options: CheckpointServiceOptions,
): (input: CheckpointRestoreInput) => Effect.Effect<CheckpointRestoreResult, CheckpointError> {
  return (input) =>
    // The whole restore body runs under the store mutex, serialized with
    // captures and other restores: it ends by writing the history back from
    // the index it loaded, so an interleaved capture's checkpoint would
    // otherwise be silently lost.
    storeMutex.withPermits(1)(restoreImpl(options, input));
}

function makePreview(
  options: CheckpointServiceOptions,
): (checkpointId: string, sessionId: string) => Effect.Effect<RestorePreview, CheckpointError> {
  return (checkpointId, sessionId) =>
    // Read under the mutex so a preview never races a concurrent write's
    // non-atomic Windows fallback path (temp-file copy) and sees a partial file.
    storeMutex.withPermits(1)(
      Effect.gen(function* () {
        const index = yield* loadSessionIndex(options.storeRoot, sessionId);
        const checkpoint = index.history.find((c) => c.id === checkpointId);
        if (!checkpoint) {
          return yield* Effect.fail(
            new CheckpointError({ message: `No checkpoint ${checkpointId}` }),
          );
        }
        yield* validateWorkspacePaths(options.workspace, checkpoint.paths.map((c) => c.path));
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
      }),
    );
}

function makeList(
  options: CheckpointServiceOptions,
): (sessionId: string) => Effect.Effect<readonly Checkpoint[], CheckpointError> {
  return (sessionId) =>
    storeMutex.withPermits(1)(
      loadSessionIndex(options.storeRoot, sessionId).pipe(Effect.map((index) => index.history)),
    );
}

// ── Validation gates ────────────────────────────────────────────────────

function quoteForShell(value: string): string {
  return process.platform === "win32" ? `"${value}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

function runCommand(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Effect.Effect<string, CheckpointError> {
  return Effect.tryPromise({
    try: async () => {
      const options = {
        cwd,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      };
      // Windows `.cmd` shims cannot be spawned directly (Node ≥ 20.12 refuses
      // without a shell), so go through cmd.exe with a quoted path. POSIX
      // shims are executable scripts and run fine via execFile with no shell.
      const result =
        process.platform === "win32"
          ? await execShellAsync(`${quoteForShell(bin)} ${args.join(" ")}`, options)
          : await execFileAsync(bin, args, options);
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

/** Resolve a tool from the workspace's own node_modules/.bin, or null. */
function findLocalBin(
  workspace: string,
  name: string,
): Effect.Effect<string | null, CheckpointError> {
  const bin = join(
    workspace,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
  return Effect.tryPromise({
    try: async () => {
      try {
        await access(bin);
        return bin;
      } catch {
        return null;
      }
    },
    catch: (cause) => new CheckpointError({ message: `Failed to probe ${name}`, cause }),
  });
}

const SKIPPABLE_SPAWN_CODES = new Set(["ENOENT", "EINVAL"]);

/**
 * Run one validation gate. A failure to even spawn the tool (rare race after
 * the existence probe) is infrastructure, not a build failure, so it is
 * skipped — otherwise a broken toolchain would silently roll back work.
 */
function runGate(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Effect.Effect<{ ok: boolean; log: string }, CheckpointError> {
  return runCommand(bin, args, cwd, timeoutMs).pipe(
    Effect.map((log) => ({ ok: true, log })),
    Effect.catchAll((error) => {
      const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
      if (code !== undefined && SKIPPABLE_SPAWN_CODES.has(code)) {
        console.warn(`[checkpoint] validation tool unavailable (${code}); gate skipped`);
        return Effect.succeed({ ok: true, log: "" });
      }
      return Effect.succeed({ ok: false, log: error.message });
    }),
  );
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
  (options: CheckpointServiceOptions) =>
  (): Effect.Effect<ValidationResult, CheckpointError> =>
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

      // Gates run the workspace's own locally-installed tools from
      // node_modules/.bin — never `npx`. npx cannot be spawned reliably from
      // Electron on Windows (ENOENT), runs against arbitrary user workspaces,
      // and can reach the network; every such failure previously read as
      // "build failed" and silently rolled the agent's work back. A tool that
      // isn't installed locally is simply not a gate this workspace runs, so
      // it is skipped rather than failed.
      const biomeBin = yield* findLocalBin(options.workspace, "biome");
      const tscBin = yield* findLocalBin(options.workspace, "tsc");
      const vitestBin = yield* findLocalBin(options.workspace, "vitest");

      const fastGate = biomeBin
        ? yield* runGate(biomeBin, ["check", "--only=syntax", "."], options.workspace, 15_000)
        : { ok: true, log: "" };

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
      const fullGate: { ok: boolean; log: string }[] = [];
      if (tscBin) {
        fullGate.push(yield* runGate(tscBin, ["--noEmit"], options.workspace, 120_000));
      }
      if (vitestBin) {
        fullGate.push(yield* runGate(vitestBin, ["run"], options.workspace, 120_000));
      }

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
      return {
        capture: makeCapture(options),
        restore: makeRestore(options),
        preview: makePreview(options),
        list: makeList(options),
        validate: makeValidate(options),
      };
    }),
  );
}
