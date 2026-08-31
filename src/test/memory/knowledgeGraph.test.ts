import { describe, expect, it } from "vitest";
import { buildKnowledgeGraph, expandGraphOneHop } from "@/lib/memory/knowledgeGraph";
import type { ProjectSkeleton } from "@/lib/projectIndex";

describe("knowledgeGraph", () => {
  it("builds requires and contains edges", () => {
    const skeleton: ProjectSkeleton = {
      modules: [
        { path: "game.ServerScriptService.Shop", name: "Shop", className: "Script", sourceLength: 100, dependencies: ["game.ReplicatedStorage.Inventory"], dependentsCount: 0, dependencyDepth: 0 },
        { path: "game.ReplicatedStorage.Inventory", name: "Inventory", className: "ModuleScript", sourceLength: 100, dependencies: [], dependentsCount: 1, dependencyDepth: 0 },
      ],
      entryPoints: ["game.ServerScriptService.Shop"],
      circularDependencies: [],
      totalScripts: 1,
      totalModuleScripts: 1,
    };
    const snapshot = {
      placeName: "Test",
      capturedAt: new Date().toISOString(),
      roots: [
        { name: "ServerScriptService", className: "ServerScriptService", path: "game.ServerScriptService", hasChildren: true, properties: [], attributes: [], children: [
          { name: "Shop", className: "Script", path: "game.ServerScriptService.Shop", hasChildren: false, properties: [], attributes: [], children: [] },
        ] },
      ],
    };
    const graph = buildKnowledgeGraph(skeleton, snapshot as unknown as import("@/lib/explorer").ExplorerSnapshot);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.some((e) => e.rel === "requires" && e.src === "game.ServerScriptService.Shop")).toBe(true);
  });

  it("expands one hop", () => {
    const skeleton: ProjectSkeleton = {
      modules: [{ path: "game.A", name: "A", className: "ModuleScript", sourceLength: 10, dependencies: ["game.B"], dependentsCount: 0, dependencyDepth: 0 }],
      entryPoints: ["game.A"],
      circularDependencies: [],
      totalScripts: 0,
      totalModuleScripts: 1,
    };
    const graph = buildKnowledgeGraph(skeleton, null as unknown as import("@/lib/explorer").ExplorerSnapshot | null);
    const expanded = expandGraphOneHop(graph, ["game.A"]);
    expect(expanded.length).toBeGreaterThan(0);
  });
});
