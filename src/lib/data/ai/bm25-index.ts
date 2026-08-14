// Lightweight BM25 retrieval tuned for mixed CJK + ASCII ebook text.

export interface Chunk {
  id: number;
  /** absolute character offset where the chunk starts (matches exploredCharCount space) */
  startChar: number;
  /** approximate end char (exclusive) */
  endChar: number;
  text: string;
}

export interface Bm25IndexShape {
  chunks: Chunk[];
  avgLen: number;
  docFreq: Map<string, number>;
  termFreq: Map<number, Map<string, number>>;
  totalDocs: number;
}

const K1 = 1.4;
const B = 0.75;
const TARGET_CHUNK_CHARS = 800;
const STOP_PUNCT = /[\s。！？，、；：「」『』（）()【】\[\]"'`~!@#$%^&*+=<>/\\.?,;:|]+/g;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // ASCII tokens
  const asciiMatches = text.toLowerCase().match(/[a-z0-9]{2,}/g);
  if (asciiMatches) tokens.push(...asciiMatches);
  // CJK character bigrams (better than unigrams for retrieval, stays cheap)
  const stripped = text.replace(/[a-zA-Z0-9]/g, ' ');
  for (const segment of stripped.split(STOP_PUNCT)) {
    if (segment.length < 2) continue;
    for (let i = 0; i < segment.length - 1; i++) {
      const bi = segment.slice(i, i + 2);
      if (/[一-鿿぀-ヿ가-힯]/.test(bi)) {
        tokens.push(bi);
      }
    }
  }
  return tokens;
}

/**
 * A chunk that starts before the reading cutoff but runs past it is the whole
 * reason `MAX_CHUNK_CHARS` exists: the retrieval filter can only reason about
 * where a chunk begins, so an oversized one drags unread text along with it.
 * Paragraphs longer than this get split.
 */
const MAX_CHUNK_CHARS = 1200;

export function chunkBookText(plainText: string): Chunk[] {
  const chunks: Chunk[] = [];
  // Split keeping the separators so offsets stay exact. The old code advanced
  // the cursor by `para.length + 1`, assuming a single newline between
  // paragraphs — but htmlToPlaintext emits one before and one after every
  // block element, so every paragraph shifted the recorded offsets a little
  // further below the truth, and chunks that should have been past the
  // spoiler cutoff tested as being before it.
  const parts = plainText.split(/(\n+)/);
  let bufferStart = 0;
  let buffer = '';
  let cursor = 0;
  let id = 0;

  const flush = () => {
    if (!buffer.trim()) {
      buffer = '';
      return;
    }
    chunks.push({
      id: id++,
      startChar: bufferStart,
      endChar: bufferStart + buffer.length,
      text: buffer
    });
    buffer = '';
  };

  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i];
    // Odd indices are the captured `\n+` separators — they only move the cursor.
    if (i % 2 === 1) {
      cursor += piece.length;
      continue;
    }

    const paraStart = cursor;
    cursor += piece.length;
    if (!piece.trim()) continue;

    let para = piece;
    let offset = paraStart;

    // A single huge paragraph would otherwise become one giant chunk.
    while (para.length > MAX_CHUNK_CHARS) {
      flush();
      bufferStart = offset;
      buffer = para.slice(0, MAX_CHUNK_CHARS);
      flush();
      para = para.slice(MAX_CHUNK_CHARS);
      offset += MAX_CHUNK_CHARS;
    }

    if (!buffer) bufferStart = offset;
    buffer = buffer ? `${buffer}\n${para}` : para;
    if (buffer.length >= TARGET_CHUNK_CHARS) flush();
  }

  flush();
  return chunks;
}

/**
 * Cut a chunk down to the part the reader has actually reached. Returns
 * undefined when nothing of it is readable yet.
 */
export function clampChunkToCutoff(chunk: Chunk, maxChar: number): Chunk | undefined {
  if (chunk.startChar >= maxChar) return undefined;
  const keep = maxChar - chunk.startChar;
  if (keep >= chunk.text.length) return chunk;
  const text = chunk.text.slice(0, keep);
  if (!text.trim()) return undefined;
  return { ...chunk, text, endChar: chunk.startChar + text.length };
}

export function buildIndex(chunks: Chunk[]): Bm25IndexShape {
  const docFreq = new Map<string, number>();
  const termFreq = new Map<number, Map<string, number>>();
  let totalLen = 0;
  for (const c of chunks) {
    const tokens = tokenize(c.text);
    totalLen += tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    termFreq.set(c.id, tf);
    for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  return {
    chunks,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
    docFreq,
    termFreq,
    totalDocs: chunks.length
  };
}

function idf(term: string, idx: Bm25IndexShape): number {
  const df = idx.docFreq.get(term) || 0;
  if (df === 0) return 0;
  return Math.log(1 + (idx.totalDocs - df + 0.5) / (df + 0.5));
}

export function searchIndex(
  idx: Bm25IndexShape,
  query: string,
  opts: { maxChar?: number; topK?: number } = {}
): Chunk[] {
  const maxChar = opts.maxChar ?? Infinity;
  const topK = opts.topK ?? 6;
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (!queryTokens.length) return [];
  const scored: { c: Chunk; score: number }[] = [];
  for (const c of idx.chunks) {
    if (c.startChar >= maxChar) continue;
    const tf = idx.termFreq.get(c.id);
    if (!tf) continue;
    const docLen = Array.from(tf.values()).reduce((a, b) => a + b, 0);
    const norm = 1 - B + B * (docLen / (idx.avgLen || 1));
    let score = 0;
    for (const t of queryTokens) {
      const f = tf.get(t);
      if (!f) continue;
      const i = idf(t, idx);
      if (!i) continue;
      score += (i * (f * (K1 + 1))) / (f + K1 * norm);
    }
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.c);
}

export function extractRecentTail(chunks: Chunk[], maxChar: number, chars: number): Chunk[] {
  const tail: Chunk[] = [];
  let accum = 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c.startChar >= maxChar) continue;
    if (accum + c.text.length > chars) break;
    tail.unshift(c);
    accum += c.text.length;
  }
  return tail;
}
