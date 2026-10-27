import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointServiceTag,
  makeCheckpointServiceLayer,
  parseGitStatusPaths,
} from "../../electron/services/CheckpointService";

const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function withService<T>(
  workspace: string,
  storeRoot: string,
  run: (service: Effect.Effect.Success<typeof CheckpointServiceTag>) => Effect.Effect<T, unknown>,
  options: { maxHistory?: number; blobGcMinAgeMs?: number } = {},
) {
  return Effect.gen(function* () {
    const service = yield* CheckpointServiceTag;
    return yield* run(service);
  }).pipe(Effect.provide(makeCheckpointServiceLayer({ workspace, storeRoot, ...options })));
}

describe("CheckpointService capture scope", () => {
  it("parses git status paths, including rename originals", () => {
    expect(parseGitStatusPaths(" M src/a.lua\0?? new.lua\0R  moved.lua\0old.lua\0")).toEqual([
      "src/a.lua",
      "new.lua",
      "moved.lua",
      "old.lua",
    ]);
  });

  it("takes one full snapshot per session, then journals only changed files", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    await execFileAsync("git", ["init", "-q"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspace });
    await writeFile(join(workspace, "tracked.lua"), "print('v1')\n");
    await writeFile(join(workspace, "untouched.lua"), "print('keep')\n");
    await execFileAsync("git", ["add", "."], { cwd: workspace });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: workspace });

    const [first, second] = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        Effect.gen(function* () {
          const before = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-1",
            tool: null,
            paths: [],
          });
          yield* Effect.tryPromise(() =>
            writeFile(join(workspace, "tracked.lua"), "print('v2')\n"),
          );
          yield* Effect.tryPromise(() => writeFile(join(workspace, "fresh.lua"), "print('new')\n"));
          const after = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-2",
            tool: null,
            paths: [],
          });
          return [before, after] as const;
        }),
      ),
    );

    expect(first.fullSnapshot).toBe(true);
    expect(first.paths.map((change) => change.path).sort()).toEqual([
      "tracked.lua",
      "untouched.lua",
    ]);

    const secondPaths = second.paths.map((change) => change.path).sort();
    expect(second.fullSnapshot).toBe(false);
    expect(secondPaths).toEqual(["fresh.lua", "tracked.lua"]);
  });

  it("keeps taking full snapshots when the workspace is not a git repository", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    await writeFile(join(workspace, "script.lua"), "print('hi')\n");

    const checkpoints = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        Effect.gen(function* () {
          const first = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-1",
            tool: null,
            paths: [],
          });
          const second = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-2",
            tool: null,
            paths: [],
          });
          return [first, second] as const;
        }),
      ),
    );

    expect(checkpoints.map((checkpoint) => checkpoint.fullSnapshot)).toEqual([true, true]);
  });
});

describe("CheckpointService change detection", () => {
  /** A git workspace with one committed file, so captures get a change list. */
  async function gitWorkspace() {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    await execFileAsync("git", ["init", "-q"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspace });
    await writeFile(join(workspace, "tracked.lua"), "print('v1')\n");
    await execFileAsync("git", ["add", "."], { cwd: workspace });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: workspace });
    return { workspace, storeRoot };
  }

  function captureAndCompare(
    workspace: string,
    storeRoot: string,
    between?: (workspace: string) => Promise<void>,
  ) {
    return Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        Effect.gen(function* () {
          const checkpoint = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-1",
            tool: null,
            paths: [],
          });
          if (between) yield* Effect.tryPromise(() => between(workspace));
          return {
            checkpoint,
            changed: yield* service.changed(checkpoint.id, "session-1"),
          };
        }),
      ),
    );
  }

  it("reports no change when a turn only read the workspace", async () => {
    const { workspace, storeRoot } = await gitWorkspace();
    const { changed } = await captureAndCompare(workspace, storeRoot);
    expect(changed).toBe(false);
  });

  it("reports a change when a journaled file was edited", async () => {
    const { workspace, storeRoot } = await gitWorkspace();
    const { changed } = await captureAndCompare(workspace, storeRoot, (root) =>
      writeFile(join(root, "tracked.lua"), "print('v2')\n"),
    );
    expect(changed).toBe(true);
  });

  it("reports a change when a file was created", async () => {
    const { workspace, storeRoot } = await gitWorkspace();
    const { changed } = await captureAndCompare(workspace, storeRoot, (root) =>
      writeFile(join(root, "new.lua"), "print('new')\n"),
    );
    expect(changed).toBe(true);
  });

  it("reports no change when an edit put the original bytes back", async () => {
    const { workspace, storeRoot } = await gitWorkspace();
    const { changed } = await captureAndCompare(workspace, storeRoot, async (root) => {
      const path = join(root, "tracked.lua");
      await writeFile(path, "print('scratch')\n");
      await writeFile(path, "print('v1')\n");
    });
    expect(changed).toBe(false);
  });

  it("reports no change for an unknown checkpoint", async () => {
    const { workspace, storeRoot } = await gitWorkspace();
    const changed = await Effect.runPromise(
      withService(workspace, storeRoot, (service) => service.changed("cp_missing", "session-1")),
    );
    expect(changed).toBe(false);
  });

  it("ignores engine caches written by the turn", async () => {
    const { workspace, storeRoot } = await gitWorkspace();

    const result = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        Effect.gen(function* () {
          const full = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-1",
            tool: null,
            paths: [],
          });
          // The engine rewrites its own caches during every turn; they are not
          // workspace edits and a restore must not roll them back.
          yield* Effect.tryPromise(() =>
            mkdir(join(workspace, ".opencode", "cache"), { recursive: true }),
          );
          yield* Effect.tryPromise(() => mkdir(join(workspace, ".bloxmind"), { recursive: true }));
          yield* Effect.tryPromise(() =>
            writeFile(join(workspace, ".opencode", "cache", "models.json"), "{}"),
          );
          yield* Effect.tryPromise(() =>
            writeFile(join(workspace, ".bloxmind", "api-dump.json"), "{}"),
          );
          const scoped = yield* service.capture({
            sessionId: "session-1",
            messageId: "message-2",
            tool: null,
            paths: [],
          });
          return {
            scopedChanged: yield* service.changed(scoped.id, "session-1"),
            scopedPaths: scoped.paths.map((change) => change.path),
            fullChanged: yield* service.changed(full.id, "session-1"),
          };
        }),
      ),
    );

    expect(result.scopedPaths).toEqual([]);
    expect(result.scopedChanged).toBe(false);
    expect(result.fullChanged).toBe(false);
  });
});

describe("CheckpointService journal encoding", () => {
  it("restores binary files byte-for-byte", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    const path = join(workspace, "place.rbxl");
    // NUL bytes and invalid UTF-8: the exact shape that a text read/write
    // round trip silently corrupts.
    const original = Buffer.from([
      0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x7f, 0x00, 0x0a, 0xc3, 0x28, 0x42,
    ]);
    await writeFile(path, original);

    const checkpoint = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.capture({
          sessionId: "session-1",
          messageId: null,
          tool: null,
          paths: ["place.rbxl"],
        }),
      ),
    );

    const [change] = checkpoint.paths;
    expect(change.preEncoding).toBe("base64");
    expect(change.preContent).toBeNull();
    expect(change.preBlob).toBe(change.preHash);
    // The pre-image lives in the content-addressed blob store, not the index.
    expect((await readFile(join(storeRoot, "blobs", change.preHash))).equals(original)).toBe(true);

    await writeFile(path, Buffer.from("agent replaced the place"));

    await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.restore({
          checkpointId: checkpoint.id,
          sessionId: "session-1",
          dryRun: false,
          preserveUserEdits: false,
        }),
      ),
    );

    const restored = await readFile(path);
    expect(restored.equals(original)).toBe(true);
  });

  it("restores UTF-8 text files exactly", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    const path = join(workspace, "hello.lua");
    const original = Buffer.from('print("héllo — ✓")\n', "utf8");
    await writeFile(path, original);

    const checkpoint = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.capture({
          sessionId: "session-1",
          messageId: null,
          tool: null,
          paths: ["hello.lua"],
        }),
      ),
    );

    expect(checkpoint.paths[0].preEncoding).toBe("utf8");
    expect(checkpoint.paths[0].preContent).toBeNull();
    expect(checkpoint.paths[0].preBlob).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(path, "corrupted");

    await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.restore({
          checkpointId: checkpoint.id,
          sessionId: "session-1",
          dryRun: false,
          preserveUserEdits: false,
        }),
      ),
    );

    expect((await readFile(path)).equals(original)).toBe(true);
  });

  it("restores checkpoints that stored the pre-image inline", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    const path = join(workspace, "legacy.lua");
    const original = "print('legacy')\n";
    await writeFile(path, original);

    const checkpoint = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.capture({
          sessionId: "session-1",
          messageId: null,
          tool: null,
          paths: ["legacy.lua"],
        }),
      ),
    );

    // Simulate an index from a build that predates blobs and `preEncoding`:
    // the payload sits inline and there is no blob reference.
    const indexFile = join(storeRoot, "sessions", "session-1", "checkpoints.json");
    const index = JSON.parse(await readFile(indexFile, "utf8")) as {
      history: Array<{ paths: Array<Record<string, unknown>> }>;
    };
    for (const entry of index.history) {
      for (const change of entry.paths) {
        change.preContent = original;
        delete change.preBlob;
        delete change.preEncoding;
      }
    }
    await writeFile(indexFile, JSON.stringify(index));

    await writeFile(path, "changed");

    const result = await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.restore({
          checkpointId: checkpoint.id,
          sessionId: "session-1",
          dryRun: false,
          preserveUserEdits: false,
        }),
      ),
    );

    expect(result.message).toContain("Restored 1 file(s)");
    expect(await readFile(path, "utf8")).toBe(original);
  });
});

describe("CheckpointService history retention", () => {
  it("caps the history and collects pre-images of trimmed checkpoints", async () => {
    const workspace = await makeTemporaryDirectory("bloxmind-cp-workspace-");
    const storeRoot = await makeTemporaryDirectory("bloxmind-cp-store-");
    const path = join(workspace, "session.lua");
    await writeFile(path, "v0");

    const { history, remainingBlobs, trimmedBlob } = await Effect.runPromise(
      withService(
        workspace,
        storeRoot,
        (service) =>
          Effect.gen(function* () {
            let firstBlob: string | null = null;
            for (let turn = 0; turn < 4; turn += 1) {
              yield* Effect.tryPromise(() => writeFile(path, `v${turn}`));
              const checkpoint = yield* service.capture({
                sessionId: "session-1",
                messageId: null,
                tool: null,
                paths: ["session.lua"],
              });
              if (turn === 0) firstBlob = checkpoint.paths[0].preBlob;
            }
            const retained = yield* service.list("session-1");
            const blobs = yield* Effect.tryPromise(() => readdir(join(storeRoot, "blobs")));
            return { history: retained, remainingBlobs: blobs, trimmedBlob: firstBlob };
          }),
        { maxHistory: 3, blobGcMinAgeMs: 0 },
      ),
    );

    expect(history).toHaveLength(3);
    expect(history.every((checkpoint) => checkpoint.paths[0].preBlob !== null)).toBe(true);
    // One blob per distinct pre-image; the trimmed checkpoint's blob is gone.
    expect(remainingBlobs).toHaveLength(3);
    expect(trimmedBlob).not.toBeNull();
    expect(remainingBlobs).not.toContain(trimmedBlob);

    // A retained checkpoint still restores byte-for-byte.
    await writeFile(path, "agent changed this");
    await Effect.runPromise(
      withService(workspace, storeRoot, (service) =>
        service.restore({
          checkpointId: history[0].id,
          sessionId: "session-1",
          dryRun: false,
          preserveUserEdits: false,
        }),
      ),
    );
    expect(await readFile(path, "utf8")).toBe("v1");
  });
});
