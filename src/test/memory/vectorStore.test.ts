import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVectorStore } from "@/lib/memory/vectorStore";
import { getEmbedder, __resetEmbedder } from "@/lib/memory/embedder";

describe("vectorStore", () => {
  let workspace: string;
  beforeEach(async () => {
    __resetEmbedder();
    workspace = await mkdtemp(join(tmpdir(), "bloxmind-mem-"));
  });

  it("upsert and query via cosine", async () => {
    const store = await createVectorStore({ workspace, forceMemory: true });
    const embedder = await getEmbedder(false);
    const docs = [
      { id: "inv", path: "game.ServerScriptService.Inventory", className: "ModuleScript" as const, parentPath: "game.ServerScriptService", source: "local Inventory = {} function Inventory.add(item) end return Inventory" },
      { id: "shop", path: "game.ServerScriptService.Shop", className: "Script" as const, parentPath: "game.ServerScriptService", source: "local Shop = {} -- shop system disconnected" },
    ];
    for (const d of docs) {
      const emb = await embedder.embedOne(`Path: ${d.path}\n${d.source}`);
      await store.upsertDocument(
        { id: d.id, path: d.path, displayPath: d.path, className: d.className, parentPath: d.parentPath, sourceHash: "h1", sourceLength: d.source.length, updatedAt: Date.now(), chunkCount: 1, rawSource: d.source, hierarchy: [], dependencies: [] },
        [{ id: `${d.id}#0`, documentId: d.id, chunkIndex: 0, content: d.source, tokenCount: 10, embedding: Array.from(emb) }],
      );
    }
    const qEmb = await embedder.embedOne("Connect a shop system to my old inventory script");
    const hits = await store.query(qEmb, 2);
    expect(hits.length).toBe(2);
    // inventory should rank higher due to keyword boost in hash fallback
    expect(hits[0].document.path).toContain("Inventory");
  });

  it("delete cascades", async () => {
    const store = await createVectorStore({ workspace, forceMemory: true });
    const emb = new Float32Array(384).fill(0.1);
    await store.upsertDocument(
      { id: "a", path: "game.A", displayPath: "game.A", className: "Script", parentPath: "game", sourceHash: "h", sourceLength: 10, updatedAt: Date.now(), chunkCount: 1, rawSource: "hello", hierarchy: [], dependencies: [] },
      [{ id: "a#0", documentId: "a", chunkIndex: 0, content: "hello", tokenCount: 1, embedding: Array.from(emb) }],
    );
    await store.deleteDocument("a");
    const docs = await store.listDocuments();
    expect(docs).toHaveLength(0);
  });
});
