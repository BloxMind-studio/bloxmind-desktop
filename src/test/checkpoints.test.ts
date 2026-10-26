import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointServiceTag,
  makeCheckpointServiceLayer,
} from "../../electron/services/CheckpointService";

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
) {
  return Effect.gen(function* () {
    const service = yield* CheckpointServiceTag;
    return yield* run(service);
  }).pipe(Effect.provide(makeCheckpointServiceLayer({ workspace, storeRoot })));
}

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
    expect(change.preContent).not.toBeNull();

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
    expect(checkpoint.paths[0].preContent).toBe(original.toString("utf8"));

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

  it("decodes checkpoints written before preEncoding existed", async () => {
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

    // Simulate an index from a build that predates the field.
    const indexFile = join(storeRoot, "sessions", "session-1", "checkpoints.json");
    const index = JSON.parse(await readFile(indexFile, "utf8")) as {
      history: Array<{ paths: Array<Record<string, unknown>> }>;
    };
    for (const entry of index.history) {
      for (const change of entry.paths) delete change.preEncoding;
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
