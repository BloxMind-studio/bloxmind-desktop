import type { KnowledgeGraph, KgEdge, KgNode } from "../../../packages/memory-types/src/index";
import type { ProjectSkeleton } from "../projectIndex";
import type { ExplorerSnapshot, ExplorerNode } from "../explorer";

function explorerNodesToKg(snapshot: ExplorerSnapshot): { nodes: KgNode[]; edges: KgEdge[] } {
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];

  function walk(node: ExplorerNode, parentPath: string | null) {
    const id = node.path; // game.Workspace.Folder
    const kind: KgNode["kind"] =
      node.className === "Folder" || node.className === "Model"
        ? "folder"
        : ["Script", "LocalScript", "ModuleScript"].includes(node.className)
          ? "script"
          : node.path.split(".")[0] === "game" && ["Workspace", "ReplicatedStorage", "ServerScriptService", "StarterPlayer", "Teams"].includes(node.name)
            ? "service"
            : "instance";
    nodes.push({ id, path: node.path, className: node.className, kind, label: node.name });
    if (parentPath) {
      edges.push({ src: parentPath, dst: id, rel: "contains" });
      edges.push({ src: id, dst: parentPath, rel: "parent" });
    }
    for (const child of node.children) walk(child, id);
  }

  for (const root of snapshot.roots) walk(root, null);
  return { nodes, edges };
}

export function buildKnowledgeGraph(
  skeleton: ProjectSkeleton,
  snapshot: ExplorerSnapshot | null,
): KnowledgeGraph {
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  const seen = new Set<string>();

  // From skeleton: script nodes + requires edges
  for (const mod of skeleton.modules) {
    const id = mod.path;
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push({
        id,
        path: mod.path,
        className: mod.className,
        kind: "script",
        label: mod.name,
      });
    }
    for (const dep of mod.dependencies) {
      // Only graph edges for resolvable game. paths (skip var:)
      if (dep.startsWith("var:")) continue;
      edges.push({ src: id, dst: dep, rel: "requires" });
      // Inverse: referenced-by
      edges.push({ src: dep, dst: id, rel: "references" });
    }
  }

  // From explorer snapshot: hierarchy
  if (snapshot) {
    const { nodes: expNodes, edges: expEdges } = explorerNodesToKg(snapshot);
    for (const n of expNodes) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        nodes.push(n);
      }
    }
    edges.push(...expEdges);
  }

  // Deduplicate edges
  const edgeKey = (e: KgEdge) => `${e.src}|${e.dst}|${e.rel}`;
  const dedup = new Map<string, KgEdge>();
  for (const e of edges) dedup.set(edgeKey(e), e);

  return { nodes, edges: [...dedup.values()] };
}

export function expandGraphOneHop(
  graph: KnowledgeGraph,
  seedIds: string[],
  limitPerSeed = 4,
): KgEdge[] {
  const seedSet = new Set(seedIds);
  const result: KgEdge[] = [];
  for (const e of graph.edges) {
    if (seedSet.has(e.src) || seedSet.has(e.dst)) {
      result.push(e);
      if (result.length >= seedIds.length * limitPerSeed) break;
    }
  }
  return result;
}
