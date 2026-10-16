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
  return createHash("sha256").update(contents).digest("hex");
}

function readTextSafe(path: string): Promise<string | null> {
  return readFile(path, "utf8").then(
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

// ── Capture / restore core ──────────────────────────────────────────────

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
      //    When no paths are given, the whole workspace is journaled so a
      //    restore works even when the workspace is not a git repository.
      const fullSnapshot = decoded.paths.length === 0;
      const changes: FileChange[] = [];
      const targetPaths = fullSnapshot
        ? yield* Effect.tryPromise({
            try: () => listWorkspaceFiles(options.workspace),
            catch: (cause) =>
              new CheckpointError({ message: "Failed to enumerate workspace", cause }),
          })
        : decoded.paths.map(toPosixPath);
      for (const relPath of targetPaths) {
        const absPath = resolve(options.workspace, relPath);
        const contents = yield* Effect.tryPromise({
          try: () => readTextSafe(absPath),
          catch: (cause) => new CheckpointError({ message: `Failed to read ${relPath}`, cause }),
        }).pipe(
          // A file that can't be read right now (locked by Studio, permissions,
          // special file) is left out of the journal instead of failing the
          // whole capture — and it is never journaled as a phantom "create",
          // which a later restore would have to interpret as "delete it".
          Effect.catchAll((error) => {
            console.warn(`[checkpoint] skipping unreadable file ${relPath}: ${error.message}`);
            return Effect.succeed<string | null | undefined>(undefined);
          }),
        );
        if (contents === undefined) continue;
        if (contents === null) {
          changes.push({
            path: relPath,
            operation: "create",
            preHash: hashContent(""),
            preContent: null,
          });
        } else {
          changes.push({
            path: relPath,
            operation: "modify",
            preHash: hashContent(contents),
            preContent:
              Buffer.byteLength(contents, "utf8") <= MAX_JOURNAL_FILE_BYTES ? contents : null,
          });
        }
      }

      // 2. Git-backed snapshot for tracked files. Untracked files are kept in
      // the journal above; `git stash create` cannot safely include them.
      const gitRef = yield* isGitRepo(options.workspace).pipe(
        Effect.flatMap((isRepo) =>
          isRepo
            ? git(
                [
                  "stash",
                  "create",
                  `bloxmind:${randomBytes(6).toString("hex")}`,
                ],
                options.workspace,
              ).pipe(
                Effect.map((out) => out.trim() || null),
                Effect.catchAll(() => Effect.succeed<string | null>(null)),
              )
            : Effect.succeed<string | null>(null),
        ),
      );

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
          yield* persistSessionIndex(options.storeRoot, sessionId, {
            history: next,
            activeIndex: next.length - 1,
          });
          return captured;
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
      const absPath = resolve(options.workspace, change.path);
      if (change.operation === "create") {
        yield* Effect.tryPromise({
          try: () => rm(absPath, { force: true }),
          catch: (cause) => new CheckpointError({ message: `Failed to remove ${change.path}`, cause }),
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
        if (change.preContent === null && change.operation === "modify") continue;
        const absPath = resolve(options.workspace, change.path);
        const after = yield* Effect.tryPromise({
          try: () => readTextSafe(absPath),
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
        } else if (after === null || hashContent(after) !== change.preHash) {
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

      const message = checkpoint.fullSnapshot
        ? `Restored entire workspace (${checkpoint.paths.length} file(s) tracked)`
        : `Restored ${checkpoint.paths.length} file(s)`;

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
