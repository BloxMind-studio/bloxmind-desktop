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
  return createHash("sha256").update(contents).digest("hex");
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
      const result = await exec("git", args, {
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

// Serializes index writes per session so concurrent capture/restore requests
// never race on the same checkpoints.json (Windows `rename` fails with EPERM
// when the destination is briefly locked by another write).
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
        });
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
                ["stash", "create", `bloxmind:${randomBytes(6).toString("hex")}`],
                options.workspace,
              ).pipe(
                Effect.map((out) => out.trim() || null),
                Effect.catchAll(() => Effect.succeed<string | null>(null)),
              )
            : Effect.succeed<string | null>(null),
        ),
      );

      // 3. Persist index (DAG: parent = activeIndex)
      const index = yield* loadSessionIndex(options.storeRoot, sessionId);
      const checkpoint: Checkpoint = {
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
      const next = [...index.history, checkpoint];
      yield* persistSessionIndex(options.storeRoot, sessionId, {
        history: next,
        activeIndex: next.length - 1,
      });

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

      // Move history cursor to the restored checkpoint.
      const nextIndex = index.history.findIndex((c) => c.id === checkpoint.id);
      yield* persistSessionIndex(options.storeRoot, decoded.sessionId, {
        ...index,
        activeIndex: nextIndex,
      });

      yield* Effect.logInfo(
        `[checkpoint] restored ${checkpoint.id} session=${decoded.sessionId} files=${scopedPaths.length}`,
      );

      // ── Rojo live-sync awareness ──────────────────────────────────────
      // The restored files live under the workspace (`src/` / `.luau`) and,
      // because `rojo serve` watches that directory, the file reversion is
      // picked up automatically. Verify Rojo is active & connected so the UI
      // can tell the user whether the code was actually pushed to Studio.
      //
      // Poll for a short window after restore: Rojo's file watcher needs a
      // brief moment to detect the reverted files and push them to Studio.
      // A single instantaneous check could report "connected" before the
      // sync actually happens, or miss a transient reconnection. Polling
      // every 250ms for up to 2s gives the watcher time to react while
      // keeping the restore feeling snappy.
      const ROJO_SYNC_POLL_INTERVAL_MS = 250;
      const ROJO_SYNC_POLL_MAX_ATTEMPTS = 8; // 8 × 250ms = 2s max
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
      };
    }),
  );
}
