import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOXMIND_PROGRAM_NAMES,
  type BloxMindProgramManifest,
  type BloxMindProgramName,
  buildBloxMindProgramManifest,
  isBloxMindProgramContract,
  isBloxMindProgramToolAllowed,
  knownBloxMindProgramTools,
  serializeBloxMindProgramManifest,
  usableBloxMindPrograms,
} from "@/lib/bloxmindProgramManifest";
import { signBloxMindProgramManifest } from "../../electron/bloxmindProgramSignature";
import { createBloxMindProgramStore } from "../../electron/services/BloxMindProgramStore";
import {
  expectedManifest,
  readProgramFile,
  validated,
} from "../../scripts/bloxmind-programs/manifestFiles";

const getBloxMindPrograms = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop", () => ({ desktop: { getBloxMindPrograms } }));

function sources(body = "async function run() { return {}; }") {
  return {
    lib: "function helper() {}",
    programs: Object.fromEntries(BLOXMIND_PROGRAM_NAMES.map((name) => [name, body])) as Record<
      BloxMindProgramName,
      string
    >,
  };
}

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("studio program manifest", () => {
  it("prepends the shared helpers and pins each program's contract", () => {
    const manifest = buildBloxMindProgramManifest(sources(), 3);

    expect(manifest.sequence).toBe(3);
    expect(manifest.programs["explorer-snapshot"]?.source).toBe(
      "function helper() {}\n\nasync function run() { return {}; }\n",
    );
    expect(manifest.programs["explorer-snapshot"]?.contract.outputSchemaVersion).toBe(
      "explorer-snapshot-v1",
    );
  });

  it("refuses to build a manifest the app would reject once the helpers are prepended", () => {
    // Under the 100,000-character envelope limit alone, over it with the helpers.
    const nearLimit = `async function run() { return "${"x".repeat(99_950)}"; }`;

    expect(() => validated(buildBloxMindProgramManifest(sources(nearLimit), 1))).toThrow(
      "would be rejected by the app",
    );
  });

  it("only uses published programs whose contract this app understands", () => {
    const manifest = buildBloxMindProgramManifest(sources(), 2);
    const discovery = manifest.programs["studio-target-discovery"];
    if (!discovery) throw new Error("missing discovery");
    const altered: BloxMindProgramManifest = {
      ...manifest,
      programs: {
        ...manifest.programs,
        "studio-target-discovery": {
          ...discovery,
          contract: { ...discovery.contract, version: "2" },
        },
      },
    };

    const usable = usableBloxMindPrograms(altered);

    expect(Object.keys(usable).sort()).toEqual(["explorer-snapshot", "studio-target-selection"]);
  });

  it("lets programs use their known tools and any tool Studio marks read-only", () => {
    // Annotations as Roblox Studio's MCP reports them (2026-09-28).
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    expect(isBloxMindProgramToolAllowed("explorer-snapshot", "search_game_tree")).toBe(true);
    expect(isBloxMindProgramToolAllowed("explorer-snapshot", "renamed_tree_tool", readOnly)).toBe(
      true,
    );
    expect(
      isBloxMindProgramToolAllowed("explorer-snapshot", "execute_luau", {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      }),
    ).toBe(false);
    expect(
      isBloxMindProgramToolAllowed("explorer-snapshot", "http_get", {
        ...readOnly,
        openWorldHint: true,
      }),
    ).toBe(false);
    expect(isBloxMindProgramToolAllowed("explorer-snapshot", "unlabelled_tool")).toBe(false);
    // MCP treats a missing openWorldHint as open-world, so it doesn't count as read-only.
    expect(
      isBloxMindProgramToolAllowed("explorer-snapshot", "maybe_network", { readOnlyHint: true }),
    ).toBe(false);
    // A tool claiming both readOnly and destructive is rejected.
    expect(
      isBloxMindProgramToolAllowed("explorer-snapshot", "sneaky_tool", {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: true,
      }),
    ).toBe(false);
    expect(isBloxMindProgramToolAllowed("something-else", "list_roblox_studios", readOnly)).toBe(
      false,
    );
  });

  it("lets the project index program read the place tree and scripts", () => {
    expect(isBloxMindProgramToolAllowed("project-index", "search_game_tree")).toBe(true);
    expect(isBloxMindProgramToolAllowed("project-index", "script_read")).toBe(true);
    // Still read-only: it may not mutate the place or reach the network.
    expect(
      isBloxMindProgramToolAllowed("project-index", "execute_luau", {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      }),
    ).toBe(false);
    expect(
      isBloxMindProgramToolAllowed("project-index", "http_get", {
        readOnlyHint: true,
        openWorldHint: true,
      }),
    ).toBe(false);
    expect(isBloxMindProgramContract("project-index")).toBe(true);
    expect(knownBloxMindProgramTools("project-index")).toEqual(["search_game_tree", "script_read"]);
  });

  it("ships a manifest.json that matches bloxmind-programs/ (run `pnpm bloxmind-programs build`)", async () => {
    // The same check as `pnpm bloxmind-programs check`, including the sequence bump.
    expect(serializeBloxMindProgramManifest(await expectedManifest())).toBe(
      await readProgramFile("manifest.json"),
    );
  });
});

describe("studio program store", () => {
  const { publicKey, privateKey } = keys();

  function published(manifest: BloxMindProgramManifest, signWith = privateKey) {
    const raw = serializeBloxMindProgramManifest(manifest);
    const signature = signBloxMindProgramManifest(raw, signWith);
    return vi.fn(
      async (url: string) => new Response(url.endsWith(".sig") ? signature : raw, { status: 200 }),
    ) as unknown as typeof fetch;
  }

  async function store(fetchImpl: typeof fetch, directory?: string) {
    const dir = directory ?? (await mkdtemp(join(tmpdir(), "bloxmind-programs-")));
    return {
      dir,
      store: createBloxMindProgramStore({ directory: dir, fetch: fetchImpl, publicKey }),
    };
  }

  it("keeps a validly signed manifest and reloads it from the cache", async () => {
    const manifest = buildBloxMindProgramManifest(sources(), 5);
    const first = await store(published(manifest));

    expect(await first.store.refresh()).toBe("updated");
    expect(first.store.current()?.sequence).toBe(5);

    const reloaded = await store(published(manifest), first.dir);
    await reloaded.store.load();
    expect(reloaded.store.current()?.sequence).toBe(5);
  });

  it("rejects a manifest signed with any other key", async () => {
    const other = keys();
    const { store: rejecting } = await store(
      published(buildBloxMindProgramManifest(sources(), 5), other.privateKey),
    );

    expect(await rejecting.refresh()).toBe("rejected");
    expect(rejecting.current()).toBeNull();
  });

  it("never goes back to an older sequence, even when it is signed", async () => {
    const { dir, store: newer } = await store(
      published(buildBloxMindProgramManifest(sources(), 7)),
    );
    await newer.refresh();

    const { store: older } = await store(
      published(buildBloxMindProgramManifest(sources("async function run() { return 1; }"), 6)),
      dir,
    );
    await older.load();

    expect(await older.refresh()).toBe("rejected");
    expect(older.current()?.sequence).toBe(7);
  });

  it("ignores a cached manifest that was changed on disk", async () => {
    const { dir, store: first } = await store(
      published(buildBloxMindProgramManifest(sources(), 4)),
    );
    await first.refresh();
    const path = join(dir, "cache.json");
    await writeFile(path, (await readFile(path, "utf8")).replace("return {}", "return evil()"));

    const { store: reloaded } = await store(
      published(buildBloxMindProgramManifest(sources(), 4)),
      dir,
    );
    await reloaded.load();

    expect(reloaded.current()).toBeNull();
  });

  it("reports a failed cache write instead of throwing", async () => {
    const blocked = join(await mkdtemp(join(tmpdir(), "bloxmind-programs-")), "file");
    await writeFile(blocked, "not a directory");
    const { store: unwritable } = await store(
      published(buildBloxMindProgramManifest(sources(), 5)),
      join(blocked, "cache"),
    );

    await expect(unwritable.refresh()).resolves.toBe("unavailable");
    expect(unwritable.current()).toBeNull();
  });

  it("runs one refresh at a time and lets a concurrent refresh join it (#118)", async () => {
    const fetchImpl = published(buildBloxMindProgramManifest(sources(), 5));
    const { dir, store: shared } = await store(fetchImpl);

    const results = await Promise.all([shared.refresh(), shared.refresh(), shared.refresh()]);

    expect(results).toEqual(["updated", "updated", "updated"]);
    // One download of the manifest and one of its signature.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await readdir(dir)).toEqual(["cache.json"]);
    // A later refresh starts a new run.
    expect(await shared.refresh()).toBe("unchanged");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("lets separate stores write the same cache at once without a rename race (#118)", async () => {
    const manifest = buildBloxMindProgramManifest(sources(), 5);
    const { dir } = await store(published(manifest));
    const writers = await Promise.all(
      Array.from({ length: 5 }, () => store(published(manifest), dir)),
    );
    const onError = vi.fn();
    const reporting = createBloxMindProgramStore({
      directory: dir,
      fetch: published(manifest),
      publicKey,
      onError,
    });

    const results = await Promise.all([
      reporting.refresh(),
      ...writers.map(({ store: writer }) => writer.refresh()),
    ]);

    expect(results.every((result) => result === "updated")).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual(["cache.json"]);
    const { store: reloaded } = await store(published(manifest), dir);
    await reloaded.load();
    expect(reloaded.current()?.sequence).toBe(5);
  });

  it("stays on what it has when the download fails", async () => {
    const failing = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const { store: offline } = await store(failing);

    expect(await offline.refresh()).toBe("unavailable");
    expect(offline.current()).toBeNull();
  });
});

describe("resolveBloxMindPrograms", () => {
  beforeEach(() => {
    vi.resetModules();
    getBloxMindPrograms.mockReset();
  });

  async function resolve() {
    const { resolveBloxMindPrograms } = await import("@/lib/bloxmindPrograms");
    const { BUILTIN_BLOXMIND_PROGRAM_MANIFEST } = await import("@/lib/builtinBloxMindPrograms");
    return {
      resolved: await resolveBloxMindPrograms(),
      builtin: BUILTIN_BLOXMIND_PROGRAM_MANIFEST,
    };
  }

  it("uses published programs that are newer than the built-in ones", async () => {
    const { BUILTIN_BLOXMIND_PROGRAM_MANIFEST } = await import("@/lib/builtinBloxMindPrograms");
    const newer = buildBloxMindProgramManifest(
      sources("async function run() { return { roots: [] }; }"),
      BUILTIN_BLOXMIND_PROGRAM_MANIFEST.sequence + 1,
    );
    getBloxMindPrograms.mockResolvedValue(newer);

    const { resolved } = await resolve();

    expect(resolved.explorer.source).toBe("published");
    expect(resolved.explorer.program.source).toBe(newer.programs["explorer-snapshot"]?.source);
    expect(resolved.targets.source).toBe("published");
  });

  it("keeps the built-in programs when the published copy isn't newer or can't be read", async () => {
    const { BUILTIN_BLOXMIND_PROGRAM_MANIFEST } = await import("@/lib/builtinBloxMindPrograms");
    getBloxMindPrograms.mockResolvedValue(
      buildBloxMindProgramManifest(sources(), BUILTIN_BLOXMIND_PROGRAM_MANIFEST.sequence),
    );
    expect((await resolve()).resolved.explorer.source).toBe("builtin");

    getBloxMindPrograms.mockRejectedValue(new Error("bridge unavailable"));
    expect((await resolve()).resolved.explorer.source).toBe("builtin");
  });

  it("falls back to the built-in program when a published one doesn't fit the app's schema", async () => {
    const { BUILTIN_BLOXMIND_PROGRAM_MANIFEST } = await import("@/lib/builtinBloxMindPrograms");
    const newer = buildBloxMindProgramManifest(
      sources(),
      BUILTIN_BLOXMIND_PROGRAM_MANIFEST.sequence + 1,
    );
    const explorer = newer.programs["explorer-snapshot"];
    if (!explorer) throw new Error("missing explorer");
    getBloxMindPrograms.mockResolvedValue({
      ...newer,
      programs: {
        ...newer.programs,
        "explorer-snapshot": { ...explorer, source: "x".repeat(100_001) },
      },
    });

    const { resolved } = await resolve();

    expect(resolved.explorer.source).toBe("builtin");
    expect(resolved.targets.source).toBe("published");
  });

  it("records each program's own origin when only some published programs are usable", async () => {
    const { BUILTIN_BLOXMIND_PROGRAM_MANIFEST } = await import("@/lib/builtinBloxMindPrograms");
    const newer = buildBloxMindProgramManifest(
      sources(),
      BUILTIN_BLOXMIND_PROGRAM_MANIFEST.sequence + 1,
    );
    const explorer = newer.programs["explorer-snapshot"];
    if (!explorer) throw new Error("missing explorer");
    getBloxMindPrograms.mockResolvedValue({
      ...newer,
      programs: {
        ...newer.programs,
        "explorer-snapshot": {
          ...explorer,
          contract: { ...explorer.contract, version: "2" },
        },
      },
    });

    const { resolved } = await resolve();

    expect(resolved.explorer.source).toBe("builtin");
    expect(resolved.targets.source).toBe("published");
  });
});
