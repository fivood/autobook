import {
  buildIndex,
  chunkBookText,
  searchIndex,
  extractRecentTail,
  type Bm25IndexShape,
  type Chunk
} from '$lib/data/ai/bm25-index';

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'tr',
  'td',
  'th',
  'blockquote',
  'pre',
  'br',
  'hr'
]);

export interface BookTextIndex {
  bookId: number;
  bookTitle: string;
  index: Bm25IndexShape;
  plaintextLen: number;
}

/** A BM25 index over a whole book runs to megabytes, and nothing evicted this
 *  map before — every book the user asked the AI about stayed resident for the
 *  session. Two entries cover the real access pattern (current book, plus the
 *  one you flipped away from and came back to) without unbounded growth. */
const MAX_CACHED_INDEXES = 2;
const cache = new Map<number, BookTextIndex>();

export function buildBookTextIndex(bookId: number, bookTitle: string, elementHtml: string): BookTextIndex {
  const cached = cache.get(bookId);
  if (cached && cached.bookTitle === bookTitle) {
    // Re-insert so Map iteration order stays least-recently-used first.
    cache.delete(bookId);
    cache.set(bookId, cached);
    return cached;
  }
  const plaintext = htmlToPlaintext(elementHtml);
  const chunks = chunkBookText(plaintext);
  const index = buildIndex(chunks);
  const value: BookTextIndex = {
    bookId,
    bookTitle,
    index,
    plaintextLen: plaintext.length
  };
  cache.delete(bookId);
  cache.set(bookId, value);
  while (cache.size > MAX_CACHED_INDEXES) {
    cache.delete(cache.keys().next().value as number);
  }
  return value;
}

function htmlToPlaintext(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  walk(doc.body, out);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function walk(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent || '');
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'svg') return;
  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) out.push('\n');
  for (const child of Array.from(el.childNodes)) walk(child, out);
  if (isBlock) out.push('\n');
}

export interface RetrievalResult {
  topChunks: Chunk[];
  recentTail: Chunk[];
  cutoffPlaintextPos: number;
}

export function retrieveSpoilerSafe(
  bti: BookTextIndex,
  query: string,
  exploredCharCount: number,
  bookCharCount: number
): RetrievalResult {
  const ratio = bookCharCount > 0 ? Math.min(1, exploredCharCount / bookCharCount) : 1;
  const cutoff = Math.max(1, Math.floor(bti.plaintextLen * ratio));
  const topChunks = searchIndex(bti.index, query, { maxChar: cutoff, topK: 6 });
  const recentTail = extractRecentTail(bti.index.chunks, cutoff, 2000);
  return { topChunks, recentTail, cutoffPlaintextPos: cutoff };
}
