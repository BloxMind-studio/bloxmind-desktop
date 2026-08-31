/**
 * Chunker for Luau / hierarchy documents.
 * Splits documents into ~512-token chunks with 128 overlap.
 * 1 token ≈ 4 chars for Luau; we keep `require` blocks intact.
 */

export interface ChunkInput {
  documentId: string;
  path: string;
  content: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

const CHUNK_TOKENS = 512;
const OVERLAP_TOKENS = 128;
const CHARS_PER_TOKEN = 4;
const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN; // ~2048
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 512

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function splitPreserveRequires(content: string): string[] {
  // Prefer splitting at blank lines or `end` boundaries to keep Lua blocks together.
  const lines = content.split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const line of lines) {
    cur.push(line);
    curLen += line.length + 1;
    const isBlockEnd = /^\s*end\s*$/.test(line) || /^\s*$/.test(line);
    if (curLen > 800 && isBlockEnd) {
      blocks.push(cur.join("\n"));
      cur = [];
      curLen = 0;
    }
  }
  if (cur.length > 0) blocks.push(cur.join("\n"));
  return blocks;
}

export function chunkDocument(input: ChunkInput): Chunk[] {
  const { documentId, content } = input;
  if (!content || content.trim().length === 0) return [];

  // If small, single chunk
  if (content.length <= CHUNK_CHARS) {
    return [
      {
        id: `${documentId}#0`,
        documentId,
        chunkIndex: 0,
        content,
        tokenCount: estimateTokens(content),
      },
    ];
  }

  const blocks = splitPreserveRequires(content);
  const chunks: Chunk[] = [];
  let buffer = "";
  let idx = 0;

  for (const block of blocks) {
    if (buffer.length + block.length + 1 <= CHUNK_CHARS) {
      buffer = buffer ? `${buffer}\n${block}` : block;
    } else {
      if (buffer) {
        chunks.push({
          id: `${documentId}#${idx++}`,
          documentId,
          chunkIndex: idx - 1,
          content: buffer,
          tokenCount: estimateTokens(buffer),
        });
        // Overlap: keep tail
        const overlap = buffer.slice(-OVERLAP_CHARS);
        buffer = `${overlap}\n${block}`.trimStart();
        // If still too large, split block itself
        while (buffer.length > CHUNK_CHARS) {
          const part = buffer.slice(0, CHUNK_CHARS);
          chunks.push({
            id: `${documentId}#${idx++}`,
            documentId,
            chunkIndex: idx - 1,
            content: part,
            tokenCount: estimateTokens(part),
          });
          buffer = `${buffer.slice(CHUNK_CHARS - OVERLAP_CHARS)}`.trimStart();
        }
      } else {
        // Single block larger than chunk -> slice
        let remaining = block;
        while (remaining.length > CHUNK_CHARS) {
          const part = remaining.slice(0, CHUNK_CHARS);
          chunks.push({
            id: `${documentId}#${idx++}`,
            documentId,
            chunkIndex: idx - 1,
            content: part,
            tokenCount: estimateTokens(part),
          });
          remaining = remaining.slice(CHUNK_CHARS - OVERLAP_CHARS);
        }
        buffer = remaining;
      }
    }
  }
  if (buffer.trim().length > 0) {
    chunks.push({
      id: `${documentId}#${idx}`,
      documentId,
      chunkIndex: idx,
      content: buffer,
      tokenCount: estimateTokens(buffer),
    });
  }
  return chunks;
}

export function chunkDocuments(docs: ChunkInput[]): Chunk[] {
  return docs.flatMap(chunkDocument);
}
