import { Schema } from "effect";

// ── Document ────────────────────────────────────────────────────────────────
export const MemoryDocumentSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  path: Schema.String,
  displayPath: Schema.String,
  className: Schema.String,
  parentPath: Schema.String,
  sourceHash: Schema.String,
  sourceLength: Schema.Number,
  updatedAt: Schema.Number,
  chunkCount: Schema.Number,
  rawSource: Schema.String,
  hierarchy: Schema.Array(Schema.String),
  dependencies: Schema.Array(Schema.String),
});
export type MemoryDocument = typeof MemoryDocumentSchema.Type;

// ── Chunk ─────────────────────────────────────────────────────────────────
export const MemoryChunkSchema = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  chunkIndex: Schema.Number,
  content: Schema.String,
  tokenCount: Schema.Number,
  embedding: Schema.Array(Schema.Number), // 384 floats normalized
});
export type MemoryChunk = typeof MemoryChunkSchema.Type;

// ── KG ────────────────────────────────────────────────────────────────────
export const KgNodeSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  className: Schema.String,
  kind: Schema.Literal("script", "instance", "folder", "service"),
  label: Schema.String,
});
export type KgNode = typeof KgNodeSchema.Type;

export const KgEdgeSchema = Schema.Struct({
  src: Schema.String,
  dst: Schema.String,
  rel: Schema.Literal("contains", "requires", "parent", "references"),
});
export type KgEdge = typeof KgEdgeSchema.Type;

export const KnowledgeGraphSchema = Schema.Struct({
  nodes: Schema.Array(KgNodeSchema),
  edges: Schema.Array(KgEdgeSchema),
});
export type KnowledgeGraph = typeof KnowledgeGraphSchema.Type;

// ── Retrieval ─────────────────────────────────────────────────────────────
export const RetrievalHitSchema = Schema.Struct({
  chunk: MemoryChunkSchema,
  document: MemoryDocumentSchema,
  score: Schema.Number,
  expandedEdges: Schema.Array(KgEdgeSchema),
});
export type RetrievalHit = typeof RetrievalHitSchema.Type;

export const RetrievalResultSchema = Schema.Struct({
  query: Schema.String,
  hits: Schema.Array(RetrievalHitSchema),
  injectedContext: Schema.String,
});
export type RetrievalResult = typeof RetrievalResultSchema.Type;

// ── Memory Meta ───────────────────────────────────────────────────────────
export const MemoryMetaSchema = Schema.Struct({
  embeddingModel: Schema.String,
  dims: Schema.Number,
  version: Schema.Number,
  lastIndexedAt: Schema.Number,
  documentCount: Schema.Number,
  chunkCount: Schema.Number,
});
export type MemoryMeta = typeof MemoryMetaSchema.Type;
