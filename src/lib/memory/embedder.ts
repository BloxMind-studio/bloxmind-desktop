/**
 * Local embedding provider.
 * - Tries @huggingface/transformers (all-MiniLM-L6-v2, 384d) when available.
 * - Falls back to deterministic hashing embedding for tests / offline without native deps.
 */

export interface Embedder {
  dims: number;
  modelId: string;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedOne(text: string): Promise<Float32Array>;
}

// Hash fallback: deterministic, normalized 384d embedding via FNV + sinusoid
function hashEmbedding(text: string, dims = 384): Float32Array {
  const vec = new Float32Array(dims);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Seed PRNG with hash
  let seed = h >>> 0;
  const mul = 1664525;
  const inc = 1013904223;
  for (let d = 0; d < dims; d++) {
    seed = (Math.imul(seed, mul) + inc) >>> 0;
    // Map to [-1,1] via sinusoid
    const v = Math.sin(seed * 0.0000001 + d) + Math.cos(seed * 0.0003 * (d + 1));
    vec[d] = v;
  }
  // Incorporate length + keyword signals for better retrieval in fallback
  const keywords = ["shop", "inventory", "leaderboard", "currency", "tool", "module", "remote", "signal"];
  for (let k = 0; k < keywords.length; k++) {
    if (text.toLowerCase().includes(keywords[k])) {
      const idx = (h + k * 53) % dims;
      vec[idx] += 2.5;
      vec[(idx + 1) % dims] += 1.2;
    }
  }
  // L2 normalize
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += vec[d] * vec[d];
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < dims; d++) vec[d] /= norm;
  return vec;
}

class HashEmbedder implements Embedder {
  dims = 384;
  modelId = "hash-fallback-384";
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => hashEmbedding(t, this.dims));
  }
  async embedOne(text: string): Promise<Float32Array> {
    return hashEmbedding(text, this.dims);
  }
}

// Lazy HF embedder
let _hfPipeline: unknown = null;

async function tryLoadHf(): Promise<Embedder | null> {
  try {
    // Dynamic import so bundler/electron can still build without the dep installed.
    // In production, `pnpm add @huggingface/transformers` makes this real.
    const dynImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    // @ts-ignore - optional dep
    const mod: unknown = await dynImport("@huggingface/transformers").catch(() => null);
    if (!mod) return null;
    const { pipeline } = mod as { pipeline: (task: string, model: string, opts?: unknown) => Promise<unknown> };
    const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true,
    } as unknown);
    _hfPipeline = pipe;
    const embedder: Embedder = {
      dims: 384,
      modelId: "Xenova/all-MiniLM-L6-v2",
      async embed(texts: string[]): Promise<Float32Array[]> {
        const results: Float32Array[] = [];
        for (const t of texts) {
          const out = (await (pipe as (text: string, opts: unknown) => Promise<{ data: Float32Array; dims: number[] }>)(t, {
            pooling: "mean",
            normalize: true,
          })) as unknown as { data: Float32Array };
          const arr = out.data ?? (out as unknown as Float32Array);
          const vec = arr instanceof Float32Array ? arr : new Float32Array(arr as unknown as number[]);
          results.push(vec);
        }
        return results;
      },
      async embedOne(text: string): Promise<Float32Array> {
        const arr = await embedder.embed([text]);
        return arr[0];
      },
    };
    return embedder;
  } catch {
    return null;
  }
}

let singleton: Embedder | null = null;

export async function getEmbedder(preferHf = true): Promise<Embedder> {
  if (singleton) return singleton;
  if (preferHf) {
    const hf = await tryLoadHf();
    if (hf) {
      singleton = hf;
      return singleton;
    }
  }
  singleton = new HashEmbedder();
  return singleton;
}

// For tests: reset singleton
export function __resetEmbedder(): void {
  singleton = null;
  void _hfPipeline;
  _hfPipeline = null;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
