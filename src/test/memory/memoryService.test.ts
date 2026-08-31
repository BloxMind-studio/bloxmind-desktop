import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeMemoryService } from "../../../electron/services/memory/MemoryService";
import { __resetEmbedder } from "@/lib/memory/embedder";
import type { ProjectSkeleton } from "@/lib/projectIndex";

describe("MemoryService", () => {
  it("indexes skeleton and searches", async () => {
    __resetEmbedder();
    const workspace = await mkdtemp(join(tmpdir(), "mem-svc-"));
    const svc = makeMemoryService({ workspace, forceMemory: true });
    await Effect.runPromise(svc.init());
    const skeleton: ProjectSkeleton = {
      modules: [
        { path: "game.ServerScriptService.Inventory", name: "Inventory", className: "ModuleScript", sourceLength: 100, dependencies: [], dependentsCount: 0, dependencyDepth: 0 },
        { path: "game.ServerScriptService.Shop", name: "Shop", className: "Script", sourceLength: 100, dependencies: ["game.ServerScriptService.Inventory"], dependentsCount: 0, dependencyDepth: 0 },
      ],
      entryPoints: ["game.ServerScriptService.Shop"],
      circularDependencies: [],
      totalScripts: 1,
      totalModuleScripts: 1,
    };
    const sources = new Map<string, string>([
      ["game.ServerScriptService.Inventory", "local Inventory = {} function Inventory.add(i) end return Inventory"],
      ["game.ServerScriptService.Shop", "local Inventory = require(game.ServerScriptService.Inventory)"],
    ]);
    const res = await Effect.runPromise(svc.indexSkeleton(skeleton, null, sources));
    expect(res.indexed).toBeGreaterThan(0);
    // Second index should skip unchanged
    const res2 = await Effect.runPromise(svc.indexSkeleton(skeleton, null, sources));
    expect(res2.skipped).toBeGreaterThan(0);

    const search = await Effect.runPromise(svc.search("Connect a shop system to my old inventory script"));
    expect(search.injected).toContain("Inventory");
  });
});
