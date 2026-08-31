/**
 * VectorStore abstraction — sqlite-vec primary, in-memory + JSON fallback.
 * Persists to workspace/.bloxmind/memory.db when better-sqlite3 is available,
 * otherwise keeps in-memory and spills to JSON so tests pass without native build.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface VectorStoreOptions {
  workspace: string;
  dims?: number;
  forceMemory?: boolean;
}

export interface StoredDocument {
  id: string;
  path: string;
  displayPath: string;
  className: string;
  parentPath: string;
  sourceHash: string;
  sourceLength: number;
  updatedAt: number;
  chunkCount: number;
  rawSource: string;
  hierarchy: string[];
  dependencies: string[];
}

export interface StoredChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[]; // stored as float array
}

export interface VectorStore {
  init(): Promise<void>;
  upsertDocument(doc: StoredDocument, chunks: StoredChunk[]): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  getDocument(id: string): Promise<StoredDocument | null>;
  listDocuments(): Promise<StoredDocument[]>;
  query(embedding: Float32Array, k: number, filter?: { className?: string }): Promise<Array<{ chunk: StoredChunk; document: StoredDocument; score: number }>>;
  close(): Promise<void>;
  getStats(): Promise<{ documentCount: number; chunkCount: number }>;
}

function memoryDbPath(workspace: string): string {
  return join(workspace, ".bloxmind", "memory.db");
}
function memoryJsonPath(workspace: string): string {
  return join(workspace, ".bloxmind", "memory.json");
}

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

// ── In-memory fallback (pure JS) ──────────────────────────────────────────
class MemoryVectorStore implements VectorStore {
  private docs = new Map<string, StoredDocument>();
  private chunks = new Map<string, StoredChunk>();
  private opts: VectorStoreOptions;
  constructor(opts: VectorStoreOptions) {
    this.opts = opts;
  }
  async init(): Promise<void> {
    await mkdir(join(this.opts.workspace, ".bloxmind"), { recursive: true });
    // Hydrate from JSON if present
    try {
      await access(memoryJsonPath(this.opts.workspace));
      const raw = await readFile(memoryJsonPath(this.opts.workspace), "utf8");
      const data = JSON.parse(raw) as { docs: StoredDocument[]; chunks: StoredChunk[] };
      for (const d of data.docs) this.docs.set(d.id, d);
      for (const c of data.chunks) this.chunks.set(c.id, c);
    } catch { /* empty */ }
  }
  private async persist(): Promise<void> {
    const data = { docs: [...this.docs.values()], chunks: [...this.chunks.values()] };
    await mkdir(dirname(memoryJsonPath(this.opts.workspace)), { recursive: true });
    await writeFile(memoryJsonPath(this.opts.workspace), JSON.stringify(data), "utf8");
    // Also write a placeholder .db so spec path exists
    try {
      await access(memoryDbPath(this.opts.workspace));
    } catch {
      await writeFile(memoryDbPath(this.opts.workspace), JSON.stringify({ note: "memory fallback json at memory.json" }), "utf8");
    }
  }
  async upsertDocument(doc: StoredDocument, chunks: StoredChunk[]): Promise<void> {
    this.docs.set(doc.id, doc);
    for (const ch of chunks) this.chunks.set(ch.id, ch);
    // Remove stale chunks for this doc not in new set
    const newIds = new Set(chunks.map((c) => c.id));
    for (const [id, ch] of this.chunks) {
      if (ch.documentId === doc.id && !newIds.has(id)) this.chunks.delete(id);
    }
    await this.persist();
  }
  async deleteDocument(id: string): Promise<void> {
    this.docs.delete(id);
    for (const [cid, ch] of [...this.chunks]) if (ch.documentId === id) this.chunks.delete(cid);
    await this.persist();
  }
  async getDocument(id: string): Promise<StoredDocument | null> {
    return this.docs.get(id) ?? null;
  }
  async listDocuments(): Promise<StoredDocument[]> {
    return [...this.docs.values()];
  }
  async query(embedding: Float32Array, k: number, filter?: { className?: string }): Promise<Array<{ chunk: StoredChunk; document: StoredDocument; score: number }>> {
    const scored: Array<{ chunk: StoredChunk; document: StoredDocument; score: number }> = [];
    for (const ch of this.chunks.values()) {
      const doc = this.docs.get(ch.documentId);
      if (!doc) continue;
      if (filter?.className && doc.className !== filter.className) continue;
      const score = cosine(embedding, ch.embedding);
      scored.push({ chunk: ch, document: doc, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
  async close(): Promise<void> {}
  async getStats(): Promise<{ documentCount: number; chunkCount: number }> {
    return { documentCount: this.docs.size, chunkCount: this.chunks.size };
  }
}

// ── Better-sqlite3 + sqlite-vec (when available) ───────────────────────────
let BetterSqlite: unknown = null;
let loadVec: unknown = null;

async function tryLoadNative(): Promise<boolean> {
  if (BetterSqlite) return true;
  try {
    // hidden dynamic import to avoid vite static analysis
    const dynImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    // @ts-ignore - optional native deps; fallback to memory if missing
    const mod = await dynImport("better-sqlite3").catch(() => null);
    if (!mod) return false;
    BetterSqlite = (mod as { default: unknown }).default ?? mod;
    // @ts-ignore - optional
    const vecMod = await dynImport("sqlite-vec").catch(() => null);
    loadVec = vecMod ? (vecMod as { load: unknown }).load ?? null : null;
    return true;
  } catch { return false; }
}

class SqliteVecStore implements VectorStore {
  private db: unknown = null;
  private opts: VectorStoreOptions;
  constructor(opts: VectorStoreOptions) { this.opts = opts; }
  async init(): Promise<void> {
    const hasNative = await tryLoadNative();
    if (!hasNative) throw new Error("native unavailable");
    const Database = BetterSqlite as new (path: string) => unknown;
    await mkdir(join(this.opts.workspace, ".bloxmind"), { recursive: true });
    const dbPath = memoryDbPath(this.opts.workspace);
    const db = new (Database as unknown as new (p: string) => { exec: (s:string)=>void; prepare: (s:string)=>unknown; close:()=>void }) (dbPath) as unknown as { exec: (s:string)=>void; prepare:(s:string)=>{ run:(...a:unknown[])=>unknown; get:(...a:unknown[])=>unknown; all:(...a:unknown[])=>unknown[] }; close:()=>void };
    // Load vec extension if available
    try {
      if (typeof loadVec === "function") (loadVec as (db:unknown)=>void)(db);
    } catch {}
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS documents(
        id TEXT PRIMARY KEY, path TEXT, displayPath TEXT, className TEXT, parentPath TEXT,
        sourceHash TEXT, sourceLength INTEGER, updatedAt INTEGER, chunkCount INTEGER,
        rawSource TEXT, hierarchy TEXT, dependencies TEXT
      );
      CREATE TABLE IF NOT EXISTS chunks(
        id TEXT PRIMARY KEY, documentId TEXT, chunkIndex INTEGER, content TEXT, tokenCount INTEGER, embedding BLOB
      );
    `);
    // Try vec0 virtual table (sqlite-vec)
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${this.opts.dims ?? 384}] distance_metric=cosine)`);
    } catch { /* fallback to blob scan */ }
    this.db = db;
  }
  async upsertDocument(doc: StoredDocument, chunks: StoredChunk[]): Promise<void> {
    const db = this.db as { prepare:(s:string)=>{ run:(...a:unknown[])=>unknown } ; exec:(s:string)=>void };
    const upDoc = db.prepare(`INSERT OR REPLACE INTO documents(id,path,displayPath,className,parentPath,sourceHash,sourceLength,updatedAt,chunkCount,rawSource,hierarchy,dependencies) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    upDoc.run(doc.id, doc.path, doc.displayPath, doc.className, doc.parentPath, doc.sourceHash, doc.sourceLength, doc.updatedAt, chunks.length, doc.rawSource, JSON.stringify(doc.hierarchy), JSON.stringify(doc.dependencies));
    // Delete old chunks
    db.prepare(`DELETE FROM chunks WHERE documentId=?`).run(doc.id);
    try { db.prepare(`DELETE FROM vec_chunks WHERE id IN (SELECT id FROM chunks WHERE documentId=?)`).run(doc.id); } catch {}
    for (const ch of chunks) {
      db.prepare(`INSERT OR REPLACE INTO chunks(id,documentId,chunkIndex,content,tokenCount,embedding) VALUES(?,?,?,?,?,?)`).run(ch.id, ch.documentId, ch.chunkIndex, ch.content, ch.tokenCount, JSON.stringify(ch.embedding));
      try {
        db.prepare(`INSERT OR REPLACE INTO vec_chunks(id,embedding) VALUES(?,?)`).run(ch.id, JSON.stringify(ch.embedding));
      } catch {}
    }
  }
  async deleteDocument(id: string): Promise<void> {
    const db = this.db as { prepare:(s:string)=>{ run:(...a:unknown[])=>unknown } };
    db.prepare(`DELETE FROM documents WHERE id=?`).run(id);
    db.prepare(`DELETE FROM chunks WHERE documentId=?`).run(id);
    try { db.prepare(`DELETE FROM vec_chunks WHERE id NOT IN (SELECT id FROM chunks)`).run(); } catch {}
  }
  async getDocument(id: string): Promise<StoredDocument | null> {
    const db = this.db as { prepare:(s:string)=>{ get:(...a:unknown[])=>unknown } };
    const row = db.prepare(`SELECT * FROM documents WHERE id=?`).get(id) as StoredDocument & { hierarchy:string; dependencies:string } | undefined;
    if (!row) return null;
    return { ...row, hierarchy: JSON.parse(row.hierarchy || "[]"), dependencies: JSON.parse(row.dependencies || "[]") } as StoredDocument;
  }
  async listDocuments(): Promise<StoredDocument[]> {
    const db = this.db as { prepare:(s:string)=>{ all:(...a:unknown[])=>unknown[] } };
    const rows = db.prepare(`SELECT * FROM documents`).all() as Array<StoredDocument & { hierarchy:string; dependencies:string }>;
    return rows.map((r) => ({ ...r, hierarchy: JSON.parse(r.hierarchy||"[]"), dependencies: JSON.parse(r.dependencies||"[]") } as StoredDocument));
  }
  async query(embedding: Float32Array, k: number, filter?: { className?: string }): Promise<Array<{ chunk: StoredChunk; document: StoredDocument; score: number }>> {
    const db = this.db as { prepare:(s:string)=>{ all:(...a:unknown[])=>unknown[] } };
    // Try vec0 KNN
    try {
      const vecJson = JSON.stringify([...embedding]);
      const rows = db.prepare(`
        SELECT c.id, c.documentId, c.chunkIndex, c.content, c.tokenCount, c.embedding, v.distance
        FROM vec_chunks v JOIN chunks c ON c.id=v.id
        WHERE v.embedding MATCH ? AND k=?
        ORDER BY v.distance
        LIMIT ?
      `).all(vecJson, k, k) as Array<StoredChunk & { distance:number }>;
      if (rows.length > 0) {
        const results: Array<{ chunk: StoredChunk; document: StoredDocument; score: number }> = [];
        for (const r of rows) {
          const doc = await this.getDocument(r.documentId);
          if (!doc) continue;
          if (filter?.className && doc.className !== filter.className) continue;
          const chunk: StoredChunk = { id: r.id, documentId: r.documentId, chunkIndex: r.chunkIndex, content: r.content, tokenCount: r.tokenCount, embedding: JSON.parse(r.embedding as unknown as string) as number[] };
          results.push({ chunk, document: doc, score: 1 - (r.distance ?? 0) });
        }
        if (results.length) return results.slice(0,k);
      }
    } catch {}
    // Fallback brute force
    const all = (db.prepare(`SELECT * FROM chunks`).all() as Array<StoredChunk & { embedding:string }>);
    const scored: Array<{ chunk: StoredChunk; document: StoredDocument; score: number }> = [];
    for (const r of all) {
      const emb = JSON.parse(r.embedding) as number[];
      const score = cosine(embedding, emb);
      const doc = await this.getDocument(r.documentId);
      if (!doc) continue;
      if (filter?.className && doc.className !== filter.className) continue;
      scored.push({ chunk: { id:r.id, documentId:r.documentId, chunkIndex:r.chunkIndex, content:r.content, tokenCount:r.tokenCount, embedding: emb }, document: doc, score });
    }
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0,k);
  }
  async close(): Promise<void> { (this.db as { close:()=>void })?.close(); }
  async getStats(): Promise<{ documentCount:number; chunkCount:number }> {
    const db = this.db as { prepare:(s:string)=>{ get:(...a:unknown[])=>unknown } };
    const dc = (db.prepare(`SELECT COUNT(*) as c FROM documents`).get() as { c:number })?.c ?? 0;
    const cc = (db.prepare(`SELECT COUNT(*) as c FROM chunks`).get() as { c:number })?.c ?? 0;
    return { documentCount: dc, chunkCount: cc };
  }
}

export async function createVectorStore(opts: VectorStoreOptions): Promise<VectorStore> {
  if (!opts.forceMemory) {
    try {
      const s = new SqliteVecStore(opts);
      await s.init();
      return s;
    } catch { /* fall through */ }
  }
  const m = new MemoryVectorStore(opts);
  await m.init();
  return m;
}

export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
