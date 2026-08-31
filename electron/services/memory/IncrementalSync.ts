/**
 * Incremental Sync — watches Rojo/src and MCP mutations, updates memory without full re-index.
 */

import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { MemoryService } from "./MemoryService";
import { parseRequireCalls } from "../../../src/lib/projectIndex";

export interface IncrementalSyncOptions {
  workspace: string;
  memoryService: MemoryService;
}

export class IncrementalSync {
  private watcher: ReturnType<typeof watch> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private hashes = new Map<string, string>();
  private running = false;

  constructor(private opts: IncrementalSyncOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const srcDir = join(this.opts.workspace, "src");
    try {
      this.watcher = watch(srcDir, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        if (!filename.endsWith(".lua") && !filename.endsWith(".luau")) return;
        this.schedule(filename);
      });
    } catch {
      // src may not exist yet — poll only
    }
  }

  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounce) clearTimeout(this.debounce);
  }

  // Called after any MCP execute that mutated the place (e.g., execute_luau that wrote a script)
  notifyMcpMutation(path: string, source: string): void {
    this.upsert(path, source);
  }

  private schedule(filename: string): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.handleFileChange(filename), 600);
  }

  private async handleFileChange(filename: string): Promise<void> {
    const full = join(this.opts.workspace, "src", filename);
    try {
      const source = await readFile(full, "utf8");
      // Derive game path from src file path: src/server/Foo.lua -> game.ServerScriptService.Foo
      const rel = filename.replace(/\\/g, "/").replace(/\.(lua|luau)$/, "");
      const parts = rel.split("/");
      // Map src/server|client|shared -> service
      const serviceMap: Record<string, string> = {
        server: "ServerScriptService",
        client: "StarterPlayer.StarterPlayerScripts",
        shared: "ReplicatedStorage",
      };
      const service = serviceMap[parts[0]] ?? parts[0];
      const rest = parts.slice(1).join(".");
      const gamePath = rest ? `game.${service}.${rest}` : `game.${service}`;
      await this.upsert(gamePath, source);
    } catch { /* file deleted */ }
  }

  private async upsert(path: string, source: string): Promise<void> {
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    if (this.hashes.get(path) === hash) return;
    this.hashes.set(path, hash);
    const deps = parseRequireCalls(source);
    const parentPath = path.split(".").slice(0, -1).join(".");
    const className = "ModuleScript";
    // Use Effect runtime via import
    const { Effect } = await import("effect");
    await Effect.runPromise(
      this.opts.memoryService.upsertDocument(path, className, parentPath, source, [parentPath], deps),
    );
  }
}
