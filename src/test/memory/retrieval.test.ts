import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVectorStore } from "@/lib/memory/vectorStore";
import { getEmbedder, __resetEmbedder } from "@/lib/memory/embedder";
import { retrieveContext } from "@/lib/memory/retrieval";

describe("retrieval", () => {
  it("injects context for shop->inventory prompt", async () => {
    __resetEmbedder();
    const workspace = await mkdtemp(join(tmpdir(), "mem-retr-"));
    const store = await createVectorStore({ workspace, forceMemory: true });
    const embedder = await getEmbedder(false);
    const invSource = "local Inventory = {} Inventory.items = {} function Inventory.add(p, item) table.insert(Inventory.items, item) end return Inventory";
    const invEmb = await embedder.embedOne(`Path: game.ServerScriptService.Inventory\n${invSource}`);
    await store.upsertDocument(
      { id: "inv", path: "game.ServerScriptService.Inventory", displayPath: "game.ServerScriptService.Inventory", className: "ModuleScript", parentPath: "game.ServerScriptService", sourceHash: "h", sourceLength: invSource.length, updatedAt: Date.now(), chunkCount: 1, rawSource: invSource, hierarchy: [], dependencies: [] },
      [{ id: "inv#0", documentId: "inv", chunkIndex: 0, content: `Path: game.ServerScriptService.Inventory\n${invSource}`, tokenCount: 20, embedding: Array.from(invEmb) }],
    );
    const res = await retrieveContext(store, null, "Connect a shop system to my old inventory script", { k: 3 });
    expect(res.injected).toContain("Inventory");
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.injected).toContain("game.ServerScriptService.Inventory");
  });
});
