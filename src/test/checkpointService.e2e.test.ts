/**
 * Real end-to-end test for CheckpointService against a temp unborn-HEAD git
 * workspace, matching the real ~/BloxMind scenario (fresh git init, no commits).
 * Verifies:
 *   1. capture() produces a checkout-able gitRef (the git-baseline fix).
 *   2. list() returns the captured checkpoint.
 *   3. restore() removes files the agent created after capture (post-restore pruning).
 */
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function mockRojo() {
  return {
    status: () => Effect.succeed({ active: false, clientConnected: false, port: null }),
    notifyRestored: () => Effect.succeed({ active: false, clientConnected: false, port: null }),
  } as never;
}

describe("CheckpointService end-to-end (unborn HEAD workspace)", () => {
  it("captures a git checkpoint, lists it, and restore removes agent-created files", async () => {
    const workspace = await makeRepo();
    const storeRoot = await mkdtemp(join(tmpdir(), "bloxmind-cp-store-"));
    tempDirs.push(storeRoot);
    await writeFile(join(workspace, "existing.lua"), "-- user code", "utf8");

    const rojoLayer = Layer.effect(RojoServerManagerTag, Effect.succeed(mockRojo()));
    const checkpointLayer = makeCheckpointServiceLayer({ storeRoot, workspace });
    // Layer.provide wires rojoLayer into the checkpoint layer for construction;
    // the merge also exposes Rojo ambiently so restore()'s own @Rojo requirement
    // is satisfied.
    const fullLayer = Layer.merge(Layer.provide(checkpointLayer, rojoLayer), rojoLayer);
    const sessionId = "ses_e2e";

    // 1. capture — must yield a gitRef (baseline commit created on unborn HEAD)
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
    expect(captureCp.fullSnapshot).toBe(true);

    // 2. list
    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CheckpointServiceTag;
        return yield* svc.list(sessionId);
      }).pipe(Effect.provide(fullLayer)),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(captureCp.id);

    // agent creates a new file AFTER capture (simulates a generated Luau script)
    const agentFile = join(workspace, "new_generated.lua");
    await writeFile(agentFile, "-- fresh generated script", "utf8");

    // 3. restore without preserveUserEdits -> must prune the agent-created file
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

    await expect(access(agentFile)).rejects.toBeTruthy();
    await access(join(workspace, "existing.lua")); // original survives
  });
});
