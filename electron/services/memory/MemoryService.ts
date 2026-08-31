import { Context, Effect, Layer } from "effect";
import { createHash } from "node:crypto";
import { chunkDocument } from "../../../src/lib/memory/chunker";
import { getEmbedder } from "../../../src/lib/memory/embedder";
import { buildKnowledgeGraph } from "../../../src/lib/memory/knowledgeGraph";
import { retrieveContext } from "../../../src/lib/memory/retrieval";
import { createVectorStore, type VectorStore, type StoredDocument } from "../../../src/lib/memory/vectorStore";
import type { KnowledgeGraph } from "../../../packages/memory-types/src/index";
import type { ProjectSkeleton } from "../../../src/lib/projectIndex";
import type { ExplorerSnapshot } from "../../../src/lib/explorer";

export interface MemoryService {
  readonly init: () => Effect.Effect<void, unknown>;
  readonly indexSkeleton: (skeleton: ProjectSkeleton, snapshot: ExplorerSnapshot | null, sources: Map<string, string>) => Effect.Effect<{ indexed: number; skipped: number }, unknown>;
  readonly upsertDocument: (path: string, className: string, parentPath: string, source: string, hierarchy: string[], dependencies: string[]) => Effect.Effect<void, unknown>;
  readonly deleteDocument: (path: string) => Effect.Effect<void, unknown>;
  readonly search: (query: string, k?: number) => Effect.Effect<{ injected: string; hits: unknown[] }, unknown>;
  readonly getGraph: () => Effect.Effect<KnowledgeGraph | null, never>;
  readonly getStats: () => Effect.Effect<{ documentCount: number; chunkCount: number; lastIndexedAt: number | null }, unknown>;
  readonly close: () => Effect.Effect<void, unknown>;
}

export class MemoryServiceTag extends Context.Tag("@BloxMind/MemoryService")<MemoryServiceTag, MemoryService>() {}

export interface MemoryServiceOptions {
  workspace: string;
  forceMemory?: boolean;
}

function docId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 32);
}

export function makeMemoryService(options: MemoryServiceOptions) {
  let store: VectorStore | null = null;
  let graph: KnowledgeGraph | null = null;
  let lastIndexedAt: number | null = null;

  const ensureStore = async () => {
    if (!store) {
      store = await createVectorStore({ workspace: options.workspace, forceMemory: options.forceMemory });
    }
    return store;
  };

  const service: MemoryService = {
    init: () =>
      Effect.tryPromise({
        try: async () => {
          await ensureStore();
        },
        catch: (e) => e as Error,
      }),
    indexSkeleton: (skeleton, snapshot, sources) =>
      Effect.tryPromise({
        try: async () => {
          const vs = await ensureStore();
          graph = buildKnowledgeGraph(skeleton, snapshot);
          let indexed = 0;
          let skipped = 0;
          const embedder = await getEmbedder();

          for (const mod of skeleton.modules) {
            const source = sources.get(mod.path) ?? "";
            const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
            const existing = await vs.getDocument(docId(mod.path));
            if (existing && existing.sourceHash === hash) {
              skipped++;
              continue;
            }
            const parentPath = mod.path.split(".").slice(0, -1).join(".") || "game";
            const doc: StoredDocument = {
              id: docId(mod.path),
              path: mod.path,
              displayPath: mod.path,
              className: mod.className,
              parentPath,
              sourceHash: hash,
              sourceLength: source.length,
              updatedAt: Date.now(),
              chunkCount: 0,
              rawSource: source,
              hierarchy: [parentPath],
              dependencies: [...mod.dependencies],
            };
            const displayContent = `Path: ${mod.path}\nClass: ${mod.className}\nParent: ${parentPath}\nDependencies: ${mod.dependencies.join(", ")}\n\n${source}`;
            const chunksRaw = chunkDocument({ documentId: doc.id, path: mod.path, content: displayContent });
            // Embed
            const embeddings = await embedder.embed(chunksRaw.map((c) => c.content));
            const storedChunks = chunksRaw.map((c, i) => ({
              id: c.id,
              documentId: c.documentId,
              chunkIndex: c.chunkIndex,
              content: c.content,
              tokenCount: c.tokenCount,
              embedding: Array.from(embeddings[i]),
            }));
            doc.chunkCount = storedChunks.length;
            await vs.upsertDocument(doc, storedChunks);
            indexed++;
          }

          // Also index hierarchy-only nodes from snapshot (Models, Folders without scripts)
          if (snapshot) {
            const walk = (nodes: ExplorerSnapshot["roots"]) => {
              for (const n of nodes) {
                const isScript = ["Script", "LocalScript", "ModuleScript"].includes(n.className);
                if (!isScript) {
                  const p = n.path;
                  const id = docId(p);
                  // Check if already indexed as script doc
                  vs.getDocument(id).then((existing) => {
                    if (!existing) {
                      const hierarchyContent = `Path: ${n.path}\nClass: ${n.className}\nName: ${n.name}\nChildren: ${n.children.map((c) => c.name).join(", ")}`;
                      const chunksRaw = chunkDocument({ documentId: id, path: p, content: hierarchyContent });
                      // Fire-and-forget embed (sync for hierarchy is less critical)
                      getEmbedder().then((emb) => emb.embed(chunksRaw.map((c) => c.content))).then((embs) => {
                        const stored = chunksRaw.map((c, i) => ({
                          id: c.id,
                          documentId: id,
                          chunkIndex: c.chunkIndex,
                          content: c.content,
                          tokenCount: c.tokenCount,
                          embedding: Array.from(embs[i]),
                        }));
                        const doc2: StoredDocument = {
                          id,
                          path: p,
                          displayPath: p,
                          className: n.className,
                          parentPath: p.split(".").slice(0, -1).join("."),
                          sourceHash: createHash("sha256").update(hierarchyContent).digest("hex").slice(0, 16),
                          sourceLength: hierarchyContent.length,
                          updatedAt: Date.now(),
                          chunkCount: stored.length,
                          rawSource: hierarchyContent,
                          hierarchy: [],
                          dependencies: [],
                        };
                        vs.upsertDocument(doc2, stored);
                      });
                    }
                  });
                }
                if (n.children.length) walk(n.children as unknown as ExplorerSnapshot["roots"]);
              }
            };
            walk(snapshot.roots);
          }

          lastIndexedAt = Date.now();
          return { indexed, skipped };
        },
        catch: (e) => e as Error,
      }),
    upsertDocument: (path, className, parentPath, source, hierarchy, dependencies) =>
      Effect.tryPromise({
        try: async () => {
          const vs = await ensureStore();
          const id = docId(path);
          const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
          const displayContent = `Path: ${path}\nClass: ${className}\nParent: ${parentPath}\nDependencies: ${dependencies.join(", ")}\n\n${source}`;
          const chunksRaw = chunkDocument({ documentId: id, path, content: displayContent });
          const embedder = await getEmbedder();
          const embs = await embedder.embed(chunksRaw.map((c) => c.content));
          const stored = chunksRaw.map((c, i) => ({
            id: c.id,
            documentId: id,
            chunkIndex: c.chunkIndex,
            content: c.content,
            tokenCount: c.tokenCount,
            embedding: Array.from(embs[i]),
          }));
          const doc: StoredDocument = {
            id,
            path,
            displayPath: path,
            className,
            parentPath,
            sourceHash: hash,
            sourceLength: source.length,
            updatedAt: Date.now(),
            chunkCount: stored.length,
            rawSource: source,
            hierarchy,
            dependencies,
          };
          await vs.upsertDocument(doc, stored);
        },
        catch: (e) => e as Error,
      }),
    deleteDocument: (path) =>
      Effect.tryPromise({
        try: async () => {
          const vs = await ensureStore();
          await vs.deleteDocument(docId(path));
        },
        catch: (e) => e as Error,
      }),
    search: (query, k) =>
      Effect.tryPromise({
        try: async () => {
          const vs = await ensureStore();
          const res = await retrieveContext(vs, graph, query, { k });
          return { injected: res.injected, hits: res.hits };
        },
        catch: (e) => e as Error,
      }),
    getGraph: () =>
      Effect.succeed(graph),
    getStats: () =>
      Effect.tryPromise({
        try: async () => {
          const vs = await ensureStore();
          const s = await vs.getStats();
          return { ...s, lastIndexedAt };
        },
        catch: (e) => e as Error,
      }),
    close: () =>
      Effect.tryPromise({
        try: async () => {
          if (store) await store.close();
        },
        catch: (e) => e as Error,
      }),
  };

  return service;
}

export function makeMemoryServiceLayer(options: MemoryServiceOptions) {
  return Layer.scoped(
    MemoryServiceTag,
    Effect.acquireRelease(Effect.sync(() => makeMemoryService(options)), (svc) => svc.close().pipe(Effect.catchAll(() => Effect.void))),
  );
}
