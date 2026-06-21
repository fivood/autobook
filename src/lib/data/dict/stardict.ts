// Minimal StarDict parser.
//
// Layout per dict in a single subdirectory:
//   foo.ifo       — key=value metadata
//   foo.idx       — concatenated (zero-terminated UTF-8 word) + (u32 BE offset) + (u32 BE length)
//   foo.dict      — raw definition bytes referenced by offset/length
//   foo.dict.dz   — gzipped foo.dict (dictzip is a gzip extension; vanilla gzip decode works)
//
// We load .ifo + .idx + full decompressed .dict bytes into memory, build a Map<word, [offset,length]>,
// and slice on lookup. ECDICT/CC-CEDICT/JMdict StarDict packs are < 60 MB combined, fine for desktop.

export interface DictMetadata {
  bookname: string;
  wordCount: number;
  sameTypeSequence: string;
}

export interface StarDict {
  meta: DictMetadata;
  /** word lowercased → list of [offset, length] (multiple entries possible for same word) */
  index: Map<string, Array<[number, number]>>;
  /** original casing of the first occurrence of each word */
  originalCase: Map<string, string>;
  dictBytes: Uint8Array;
  lookup(word: string): string[];
}

export function parseIfo(text: string): DictMetadata {
  const meta: DictMetadata = { bookname: 'Dictionary', wordCount: 0, sameTypeSequence: 'm' };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-zA-Z_]+)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'bookname') meta.bookname = v;
    else if (k === 'wordcount') meta.wordCount = parseInt(v, 10) || 0;
    else if (k === 'sametypesequence') meta.sameTypeSequence = v;
  }
  return meta;
}

export function parseIdx(buf: Uint8Array): {
  index: Map<string, Array<[number, number]>>;
  originalCase: Map<string, string>;
} {
  const index = new Map<string, Array<[number, number]>>();
  const originalCase = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');
  let i = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (i < buf.length) {
    // find zero terminator
    let j = i;
    while (j < buf.length && buf[j] !== 0) j++;
    if (j >= buf.length - 8) break;
    const word = decoder.decode(buf.subarray(i, j));
    const offset = dv.getUint32(j + 1, false);
    const length = dv.getUint32(j + 5, false);
    const key = word.toLowerCase();
    const entries = index.get(key);
    if (entries) entries.push([offset, length]);
    else {
      index.set(key, [[offset, length]]);
      originalCase.set(key, word);
    }
    i = j + 9;
  }
  return { index, originalCase };
}

export async function decompressDictDz(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable; cannot decode .dict.dz');
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  }).pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function buildStarDict(
  meta: DictMetadata,
  idx: { index: Map<string, Array<[number, number]>>; originalCase: Map<string, string> },
  dictBytes: Uint8Array
): StarDict {
  const decoder = new TextDecoder('utf-8');
  return {
    meta,
    index: idx.index,
    originalCase: idx.originalCase,
    dictBytes,
    lookup(word: string): string[] {
      const variants = expandVariants(word);
      for (const v of variants) {
        const entries = idx.index.get(v);
        if (!entries) continue;
        return entries.map(([off, len]) => decoder.decode(dictBytes.subarray(off, off + len)));
      }
      return [];
    }
  };
}

/**
 * Simple lemma fallback: try the word, then strip common English suffixes,
 * then try lowercase. For richer English lemmatization the user can install
 * a wordnet/ecdict-style stem-mapping dict alongside.
 */
function expandVariants(word: string): string[] {
  const out: string[] = [];
  const w = word.trim();
  if (!w) return out;
  out.push(w);
  const lower = w.toLowerCase();
  if (lower !== w) out.push(lower);
  // crude English derivations
  if (/^[a-z]+$/.test(lower)) {
    if (lower.endsWith('ies')) out.push(lower.slice(0, -3) + 'y');
    if (lower.endsWith('es')) out.push(lower.slice(0, -2));
    if (lower.endsWith('s') && !lower.endsWith('ss')) out.push(lower.slice(0, -1));
    if (lower.endsWith('ing')) {
      out.push(lower.slice(0, -3));
      out.push(lower.slice(0, -3) + 'e');
    }
    if (lower.endsWith('ed')) {
      out.push(lower.slice(0, -2));
      out.push(lower.slice(0, -1));
    }
    if (lower.endsWith('er')) out.push(lower.slice(0, -2));
    if (lower.endsWith('est')) out.push(lower.slice(0, -3));
  }
  return out;
}
