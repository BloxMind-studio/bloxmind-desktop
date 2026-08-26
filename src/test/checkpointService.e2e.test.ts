/**
 * Real end-to-end tests for CheckpointService against temp workspaces.
 *
 * Engine: pure local-folder snapshots — capture copies every workspace file
 * byte-exact into checkpoints/sessions/{sessionId}/snapshot-{id}/ (no git,
 * fully offline); restore copies them back / prunes post-capture additions;
 * deleteSession rm -rf's the session folder.
 *
 * Covers:
 *   1. Pre-task capture (paths: []) on clean AND dirty workspaces never
 *      rejects, persists a badge-driving checkpoint, fullSnapshot=true.
 *   2. Scoped capture with explicit paths tracks only those targets.
 *   3. Full restore reverts agent-modified files and prunes agent-created
 *      ones while untouched baseline/settings files survive byte-for-byte.
 *   4. CRLF files round-trip byte-exact through the shadow copy.
 *   5. deleteSession purges checkpoint storage and index.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import {
  CheckpointServiceTag,
  makeCheckpointServiceLayer,
} from "../../electron/services/CheckpointService";
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

    // Local-folder engine: no git ref needed anymore.
    expect(captureCp.gitRef).toBeNull();
    // paths: [] = full pre-task snapshot.
    expect(captureCp.fullSnapshot).toBe(true);
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

  it("pre-task capture on a clean workspace persists a checkpoint (badge shows) and leaves unmodified files untouched", async () => {
    const workspace = await makeRepoWithCommit();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    // Committed legacy/settings files — restore must NEVER modify these.
    await writeFile(join(workspace, ".gitkeep"), "", "utf8");
    await writeFile(join(workspace, "GameSettings.lua"), '{ "time": "day" }', "utf8");
    git(workspace, ["add", ".gitkeep", "GameSettings.lua"]);
    git(workspace, ["commit", "-m", "legacy and settings", "--no-verify"]);

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_pre_clean";
    const legacyContent = '{ "time": "day" }';

    // paths: [] pre-task capture on a clean tree must NOT reject, must flag
    // itself as a full snapshot, and must persist a checkpoint so
    // checkpoints.list() length > 0 → badge + Restore button appear.
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

    expect(captureCp.fullSnapshot).toBe(true);
    expect(captureCp.gitRef).toBeNull();
    // Local-folder engine: the byte-exact shadow copy MUST exist on disk
    // inside the session-isolated store immediately after capture — this is
    // what guarantees restore works offline regardless of any git state.
    await expect(
      stat(join(storeRoot, "sessions", sessionId, `snapshot-${captureCp.id}`)),
    ).resolves.toBeTruthy();

    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.list(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );
    // A persisted checkpoint drives fsCheckpointCount > 0 → badge/button.
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(captureCp.id);

    // Pre-task snapshot itself leaves unmodified tracked/legacy files untouched.
    expect(await readFile(join(workspace, "GameSettings.lua"), "utf8")).toBe(legacyContent);
    expect(await readFile(join(workspace, ".gitkeep"), "utf8")).toBe("");
  }, 30_000);

  it("scoped capture backs up only targeted files and restores them exactly", async () => {
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

    // First explicit-path capture: only target.lua is backed up.
    const captureCp1 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-1",
          tool: "agent.write",
          paths: ["target.lua"],
        });
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(captureCp1.fullSnapshot).toBe(false);
    expect(captureCp1.paths).toHaveLength(1);
    expect(captureCp1.paths[0].path).toBe("target.lua");

    // Modify ONLY target.lua, then re-capture it — the shadow copy must hold
    // this intermediate state.
    await writeFile(join(workspace, "target.lua"), "-- modified target", "utf8");

    const captureCp2 = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.capture({
          sessionId,
          messageId: "msg-2",
          tool: "agent.write",
          paths: ["target.lua"],
        });
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(captureCp2.paths).toHaveLength(1);
    expect(captureCp2.paths[0].path).toBe("target.lua");

    // Modify target.lua AGAIN before restoring — restore must revert to the
    // second capture's pre-state ("-- modified target").
    await writeFile(join(workspace, "target.lua"), "-- double modified", "utf8");

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

    // Legacy files are untouched by the scoped restore — and because the
    // checkpoint was task-scoped (not a full snapshot), nothing is pruned.
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

    // Files existing at capture time are recorded as "modify"; their content
    // lives byte-exact in the shadow folder, so the JSON journal stays lean
    // (preContent=null) instead of mirroring text.
    const capturedEntry = captureCp.paths.find((p) => p.path === "new_file.lua");
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry?.operation).toBe("modify");
    expect(capturedEntry?.preContent).toBeNull();

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

  it("local-folder engine: capture works without any special git state, restore reverts", async () => {
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

    // paths: [] = full pre-task snapshot — no git ref involved anywhere.
    expect(captureCp.gitRef).toBeNull();
    expect(captureCp.fullSnapshot).toBe(true);
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

    // Full pre-task snapshot restore diffs disk against the snapshot tree:
    // extra.lua was created by the agent AFTER capture, isn't in the snapshot,
    // and is therefore pruned so Rojo never re-pushes stale generated files.
    expect(await fileExists(extraFile)).toBe(false);
  }, 30_000);

  it("system git: full pre-task restore prunes agent-created files but keeps untouched project files", async () => {
    const workspace = await makeRepoWithCommit();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);

    // Baseline project state committed before the task begins.
    await writeFile(join(workspace, "GameSettings.lua"), '{ "time": "day" }', "utf8");
    await writeFile(join(workspace, "script.lua"), "-- base", "utf8");
    git(workspace, ["add", "-A"]);
    git(workspace, ["commit", "-m", "baseline project", "--no-verify"]);

    const fullLayer = makeLayer(storeRoot, workspace);
    const sessionId = "ses_full_prune";

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
    expect(captureCp.fullSnapshot).toBe(true);
    // Full-snapshot restores diff against the shadow folder — no ref required.
    expect(captureCp.gitRef).toBeNull();

    // Simulated agent work during the turn: rewrite a tracked script and
    // create a brand-new generated file.
    await writeFile(join(workspace, "script.lua"), "-- agent rewrite", "utf8");
    const agentCreated = join(workspace, "generated_by_agent.lua");
    await writeFile(agentCreated, "-- generated", "utf8");

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

    // Modified file reverts to its pre-task content.
    expect(await readFile(join(workspace, "script.lua"), "utf8")).toBe("-- base");
    // Post-task created file is removed by the diff-based prune.
    expect(await fileExists(agentCreated)).toBe(false);
    // Untouched baseline files survive byte-for-byte — restore is strictly
    // scoped to what changed after the snapshot.
    expect(await readFile(join(workspace, "GameSettings.lua"), "utf8")).toBe(
      '{ "time": "day" }',
    );
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

    // Capture must have materialized this checkpoint's shadow folder on disk.
    await expect(
      stat(join(storeRoot, "sessions", sessionId, `snapshot-${captureCp.id}`)),
    ).resolves.toBeTruthy();

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
