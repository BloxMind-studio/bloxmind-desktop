import type { KnowledgeGraph } from "../../../packages/memory-types/src/index";
import { expandGraphOneHop } from "./knowledgeGraph";
import type { VectorStore } from "./vectorStore";
import { getEmbedder } from "./embedder";

export interface RetrievalOptions {
  k?: number; // chunk topK
  expandGraph?: boolean;
  filterClassName?: string;
}

export interface Hit {
  chunkId: string;
  documentId: string;
  path: string;
  className: string;
  content: string;
  score: number;
}

export async function retrieveContext(
  vectorStore: VectorStore,
  graph: KnowledgeGraph | null,
  query: string,
  opts: RetrievalOptions = {},
): Promise<{ injected: string; hits: Hit[]; edges: import("../../../packages/memory-types/src/index").KgEdge[] }> {
  const k = opts.k ?? 8;
  const embedder = await getEmbedder();
  const qEmb = await embedder.embedOne(query);
  const results = await vectorStore.query(qEmb, k, opts.filterClassName ? { className: opts.filterClassName } : undefined);

  const hits: Hit[] = results.map((r) => ({
    chunkId: r.chunk.id,
    documentId: r.document.id,
    path: r.document.path,
    className: r.document.className,
    content: r.chunk.content,
    score: r.score,
  }));

  const seedIds = [...new Set(results.map((r) => r.document.id))];
  const edges = graph && opts.expandGraph !== false ? expandGraphOneHop(graph, seedIds, 4) : [];

  // Build injected context block
  let injected = "";
  if (hits.length > 0) {
    const lines: string[] = [];
    lines.push("<!-- bloxmind:memory-context -->");
    lines.push("Relevant existing project context (from local .bloxmind/memory.db). Use these paths, variable names and module dependencies when generating code:");
    for (let i = 0; i < Math.min(hits.length, 6); i++) {
      const h = hits[i];
      const doc = results[i].document;
      lines.push(`\n--- [${i + 1}] ${doc.path} (${doc.className}) score=${h.score.toFixed(3)} ---`);
      lines.push(`Parent: ${doc.parentPath} | Dependencies: ${(doc.dependencies || []).join(", ") || "none"}`);
      const snippet = h.content.slice(0, 900);
      lines.push("Snippet:");
      lines.push(snippet);
    }
    if (edges.length > 0) {
      lines.push(`\nKnowledge graph edges (1-hop):`);
      for (const e of edges.slice(0, 12)) lines.push(`- ${e.src} -[${e.rel}]-> ${e.dst}`);
    }
    lines.push("<!-- /bloxmind:memory-context -->");
    injected = lines.join("\n");
  }

  return { injected, hits, edges };
}
