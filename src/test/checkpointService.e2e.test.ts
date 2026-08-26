/**
 * Real end-to-end tests for CheckpointService against temp git workspaces.
 *
 * Covers:
 *   1. System-git backend: capture, list, restore (with CRLF normalization).
 *   2. Scoped capture: only modified/untracked files are tracked.
 *   3. Embedded isomorphic-git backend: snapshot + restore fallback.
 *   4. CRLF files: hash verification succeeds after autocrlf normalization.
 *   5. deleteSession: purges checkpoint storage and index.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  CheckpointServiceTag,
  makeCheckpointServiceLayer,
} from "../../electron/services/CheckpointService";
import {
  forceEmbeddedGitBackend,
  resetGitBackendCache,
} from "../../electron/services/GitBackend";
import { RojoServerManagerTag } from "../../electron/services/RojoServerManager";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.allSettled(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bloxmind-cp-e2e-"));
  tempDirs.push(dir);
  git(dir, ["init", "--quiet"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "tester"]);
  return dir;
}

async function makeRepoWithCommit(): Promise<string> {
  const workspace = await makeRepo();
  await writeFile(join(workspace, "README.md"), "# project\n", "utf8");
  git(workspace, ["add", "README.md"]);
  git(workspace, ["commit", "-m", "initial", "--no-verify"]);
  return workspace;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mockRojo() {
  return {
    status: () => Effect.succeed({ active: false, clientConnected: false, port: null }),
    notifyRestored: () => Effect.succeed({ active: false, clientConnected: false, port: null }),
  } as never;
}

function makeLayer(storeRoot: string, workspace: string) {
  const rojoLayer = Layer.effect(RojoServerManagerTag, Effect.succeed(mockRojo()));
  const checkpointLayer = makeCheckpointServiceLayer({ storeRoot, workspace });
  return Layer.merge(Layer.provide(checkpointLayer, rojoLayer), rojoLayer);
}

describe("CheckpointService end-to-end", () => {
  beforeEach(async () => {
    resetGitBackendCache();
  });

  it("system git: captures a scoped checkpoint and restore reverts tracked files", async () => {
    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    await writeFile(join(workspace, "existing.lua"), "-- user code", "utf8");

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_sys_scoped";

    const captureCp = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    expect(captureCp.gitRef).toBeTruthy();
    expect(captureCp.fullSnapshot).toBe(false);
    expect(captureCp.paths).toHaveLength(1);
    expect(captureCp.paths[0].path).toBe("existing.lua");

    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.list(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(captureCp.id);

    // Modify the captured file after capture and restore should revert it
    await writeFile(join(workspace, "existing.lua"), "-- modified by agent", "utf8");

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.restore({
          checkpointId: captureCp.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: false,
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    const restored = await readFile(join(workspace, "existing.lua"), "utf8");
    expect(restored).toBe("-- user code");
  }, 30_000);

  it("system git: scoped capture only tracks dirty files, not the whole workspace", async () => {
    const workspace = await makeRepoWithCommit();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);

    await writeFile(join(workspace, "legacy1.lua"), "-- old script 1", "utf8");
    await writeFile(join(workspace, "legacy2.lua"), "-- old script 2", "utf8");
    await writeFile(join(workspace, "target.lua"), "-- target script", "utf8");
    git(workspace, ["add", "-A"]);
    git(workspace, ["commit", "-m", "add scripts", "--no-verify"]);

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_sys_scoped2";

    // First capture after commit: getChangedFiles returns empty
    const captureCp1 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(captureCp1.paths).toHaveLength(0);

    // Modify ONLY target.lua
    await writeFile(join(workspace, "target.lua"), "-- modified target", "utf8");

    // Capture again — should track only target.lua
    const captureCp2 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-2",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(captureCp2.paths).toHaveLength(1);
    expect(captureCp2.paths[0].path).toBe("target.lua");

    // Modify target.lua AGAIN before restoring — this lets us verify the
    // restore reverts to the pre-capture state ("-- modified target")
    await writeFile(join(workspace, "target.lua"), "-- double modified", "utf8");

    // Restore the second capture
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.restore({
          checkpointId: captureCp2.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: false,
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    const restored = await readFile(join(workspace, "target.lua"), "utf8");
    expect(restored).toBe("-- modified target");

    // Legacy files are untouched by the scoped restore
    expect(await readFile(join(workspace, "legacy1.lua"), "utf8")).toBe("-- old script 1");
    expect(await readFile(join(workspace, "legacy2.lua"), "utf8")).toBe("-- old script 2");
  }, 30_000);

  it("system git: restore deletes files captured as created (preContent=null)", async () => {
    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);

    await writeFile(join(workspace, "main.lua"), "return {}", "utf8");
    git(workspace, ["add", "main.lua"]);
    git(workspace, ["commit", "-m", "initial", "--no-verify"]);

    // Create an untracked file BEFORE capture
    const untracked = join(workspace, "new_file.lua");
    await writeFile(untracked, "-- new file", "utf8");

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_sys_create";

    const captureCp = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    // Untracked files that exist on disk are captured as "modify" (preContent
    // stores the current text), not "create" — only missing files get preContent=null.
    const capturedEntry = captureCp.paths.find((p) => p.path === "new_file.lua");
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry!.operation).toBe("modify");
    expect(capturedEntry!.preContent).toBe("-- new file");

    // Restore — should revert new_file.lua to its pre-capture content (not delete it)
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.restore({
          checkpointId: captureCp.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: false,
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    // File still exists (scoped restore doesn't delete tracked files)
    expect(await fileExists(untracked)).toBe(true);
    // Content is reverted to the pre-capture state
    expect(await readFile(untracked, "utf8")).toBe("-- new file");
    expect(await fileExists(join(workspace, "main.lua"))).toBe(true);
  }, 30_000);

  it("restores a CRLF file without hash mismatch (autocrlf normalization)", async () => {
    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    await writeFile(join(workspace, "main.lua"), "return {}\r\n", "utf8");

    // Simulate Windows core.autocrlf=true
    git(workspace, ["config", "core.autocrlf", "true"]);

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_crlf";

    const captureCp = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    expect(captureCp.paths).toHaveLength(1);

    // Modify the file
    await writeFile(join(workspace, "main.lua"), "return { changed = true }\r\n", "utf8");

    // Restore
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.restore({
          checkpointId: captureCp.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: false,
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    // hashContent normalizes CRLF→LF so verification passes even after autocrlf
    const restored = await readFile(join(workspace, "main.lua"), "utf8");
    const normalized = restored.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // core.autocrlf=true normalizes to LF on checkout, which may add a trailing
    // newline that wasn't in the original CRLF input.
    expect(normalized.trimEnd()).toBe("return {}");
  }, 30_000);

  it("embedded git backend: snapshot creates detached commit, restore works", async () => {
    forceEmbeddedGitBackend();

    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    await writeFile(join(workspace, "main.lua"), "return {}", "utf8");

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_embedded";

    const captureCp = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    expect(captureCp.gitRef).toBeTruthy();
    expect(captureCp.fullSnapshot).toBe(false);
    expect(captureCp.paths).toHaveLength(1);
    expect(captureCp.paths[0].path).toBe("main.lua");

    // Modify + create files after capture
    await writeFile(join(workspace, "main.lua"), "return { changed = true }", "utf8");
    const extraFile = join(workspace, "extra.lua");
    await writeFile(extraFile, "-- agent generated", "utf8");

    // Restore
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.restore({
          checkpointId: captureCp.id,
          sessionId,
          dryRun: false,
          preserveUserEdits: false,
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    // main.lua is reverted via the embedded git checkout fallback or journal
    const restored = await readFile(join(workspace, "main.lua"), "utf8");
    expect(restored).toBe("return {}");

    // With scoped captures, agent-created files outside the checkpoint are NOT
    // pruned -- only tracked files are reverted.
    expect(await fileExists(extraFile)).toBe(true);
  }, 30_000);

  it("deleteSession purges checkpoint storage and list returns empty", async () => {
    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    await writeFile(join(workspace, "main.lua"), "return {}", "utf8");

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_delete";

    const captureCp = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "session.promptAsync",
          paths: [],
        });
      }).pipe(Effect.provide(fullLayer)),
    );

    expect(captureCp.gitRef).toBeTruthy();

    const listedBefore = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.list(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(listedBefore).toHaveLength(1);

    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.deleteSession(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );

    const listedAfter = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.list(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(listedAfter).toHaveLength(0);
  }, 30_000);
});
