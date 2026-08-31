/**
 * ProjectMemoryIndexer — MCP-side background indexer.
 * Scans the active Roblox Studio project tree via MCP (search_game_tree + read_script)
 * and hands results to MemoryService for embedding.
 */

import { Effect } from "effect";
import type { ProjectSkeleton } from "../../../src/lib/projectIndex";
import type { ExplorerSnapshot } from "../../../src/lib/explorer";
import type { MemoryService } from "./MemoryService";

export interface IndexerOptions {
  memoryService: MemoryService;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

function normalizeMcpResult(result: unknown): unknown {
  const content = (result as { content?: unknown })?.content ?? result;
  if (Array.isArray(content)) {
    for (const part of content as Array<{ type?: string; text?: string; json?: unknown }>) {
      if (part?.type === "json") return part.json;
      if (part?.type === "text" && typeof part.text === "string") {
        try { return JSON.parse(part.text); } catch { return part.text; }
      }
    }
  }
  if (typeof content === "string") {
    try { return JSON.parse(content); } catch { return content; }
  }
  return content;
}

export async function scanProjectTree(callTool: IndexerOptions["callTool"]): Promise<{
  skeleton: ProjectSkeleton;
  snapshot: ExplorerSnapshot | null;
  sources: Map<string, string>;
}> {
  const raw = normalizeMcpResult(
    await callTool("search_game_tree", {
      datamodel_type: "Edit",
      max_depth: 10,
      head_limit: 100_000,
    }),
  );
  const rows: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : Array.isArray((raw as { instances?: unknown[] })?.instances)
      ? ((raw as { instances: Array<Record<string, unknown>> }).instances)
      : [];

  const scriptRows = rows.filter((r) => {
    const cn = r["className"] as string;
    return ["Script", "LocalScript", "ModuleScript"].includes(cn);
  });

  const sources = new Map<string, string>();
  // Parallel read_script (batch 8)
  const batchSize = 8;
  for (let i = 0; i < scriptRows.length; i += batchSize) {
    const batch = scriptRows.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (row) => {
        const fullPath = (row["fullPath"] as string) || (row["path"] as string) || "";
        if (!fullPath) return;
        const qPath = fullPath.startsWith("game.") ? fullPath : `game.${fullPath}`;
        try {
          const res = normalizeMcpResult(await callTool("read_script", { script_path: qPath }));
          let src = "";
          if (typeof res === "string") src = res;
          else if (res && typeof res === "object" && "source" in (res as Record<string, unknown>)) src = (res as { source: string }).source;
          else if (res && typeof res === "object" && "content" in (res as Record<string, unknown>)) src = (res as { content: string }).content;
          sources.set(qPath, src ?? "");
        } catch { /* skip unreadable */ }
      }),
    );
  }

  // Build skeleton via local parser (mirrors builtinProjectPrograms logic without needing GeneratedProgram)
  const { parseRequireCalls, buildDependencyGraph } = await import("../../../src/lib/projectIndex");
  const modulesInput = scriptRows.map((row) => {
    const fullPath = (row["fullPath"] as string) || (row["path"] as string) || "";
    const qPath = fullPath.startsWith("game.") ? fullPath : `game.${fullPath}`;
    const src = sources.get(qPath) ?? "";
    // Use parseRequireCalls on stripped source
    const deps = parseRequireCalls(src);
    const props = row["properties"] as Record<string, unknown> | undefined;
    const name =
      (props && typeof props["Name"] === "string" && (props["Name"] as string)) ||
      (row["Name"] as string) ||
      (row["name"] as string) ||
      qPath.split(".").at(-1) ||
      qPath;
    return {
      path: qPath,
      name,
      className: (row["className"] as string) || "ModuleScript",
      sourceLength: src.length,
      dependencies: deps,
    };
  });

  const { modules, entryPoints, circularDependencies } = buildDependencyGraph(modulesInput);
  const skeleton: ProjectSkeleton = {
    modules,
    entryPoints,
    circularDependencies,
    totalScripts: modules.filter((m) => m.className !== "ModuleScript").length,
    totalModuleScripts: modules.filter((m) => m.className === "ModuleScript").length,
  };

  // Build lightweight snapshot for KG hierarchy (from same rows)
  const snapshot: ExplorerSnapshot = {
    placeName: "Roblox Studio",
    capturedAt: new Date().toISOString(),
    roots: [], // indexer KG hierarchy is built from fullPath parent chain, not explorer tree. Keep empty and let MemoryService use skeleton path hierarchy.
  };
  // Provide minimal snapshot by using explorer-like roots from top-level services
  // Group rows by top-level service
  const topLevel = new Map<string, typeof rows>();
  for (const r of rows) {
    const p = ((r["fullPath"] as string) || (r["path"] as string) || "").split(".")[0] || "Workspace";
    const arr = topLevel.get(p) ?? [];
    arr.push(r);
    topLevel.set(p, arr);
  }
  // If no snapshot needed, return null to let MemoryService use skeleton only
  // But we still want to provide something for KG nodes if available
  return { skeleton, snapshot: snapshot.roots.length ? snapshot : null, sources };
}

export class ProjectMemoryIndexer {
  constructor(private opts: IndexerOptions) {}

  async fullReindex(): Promise<{ indexed: number; skipped: number }> {
    const { skeleton, snapshot, sources } = await scanProjectTree(this.opts.callTool);
    const result = await Effect.runPromise(this.opts.memoryService.indexSkeleton(skeleton, snapshot, sources));
    return result;
  }

  async incrementalUpsert(path: string, className: string, parentPath: string, source: string, dependencies: string[]): Promise<void> {
    await Effect.runPromise(
      this.opts.memoryService.upsertDocument(path, className, parentPath, source, [parentPath], dependencies),
    );
  }

  async deletePath(path: string): Promise<void> {
    await Effect.runPromise(this.opts.memoryService.deleteDocument(path));
  }
}
