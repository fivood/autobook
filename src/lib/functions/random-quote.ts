/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Pure half of the library's random-quote card: which paragraph of an unread
 * book gets shown. Kept free of DOM / IDB imports so `npm test` can run it
 * under plain node; the loader that feeds it lives in random-quote-loader.ts.
 */

export interface QuoteBlock {
  text: string;
  /** Reader character count (`getCharacterCount` basis) at the block's start —
   * the same number `/b?pos=` hands to `scrollToBookmark`. */
  pos: number;
}

/**
 * Only the opening stretch is eligible. The point of the card is "this looks
 * interesting, keep reading", and a random paragraph from the middle of a
 * mystery novel is as likely to be the reveal as anything else. The first 2%
 * is skipped because that is copyright pages, dedications and tables of
 * contents, none of which sell a book.
 */
export const QUOTE_RANGE = { from: 0.02, to: 0.15 };

const MIN_LEN = 40;
const MAX_LEN = 200;
const ENDS_A_SENTENCE = /[。！？!?….」』”"]$/;
const LOOKS_LIKE_A_HEADING = /^(第.{1,8}[章节回部卷篇幕]|chapter\b|part\b|prologue\b)/i;

export function isQuotable(text: string): boolean {
  const len = Array.from(text).length;
  return (
    len >= MIN_LEN &&
    len <= MAX_LEN &&
    ENDS_A_SENTENCE.test(text) &&
    !LOOKS_LIKE_A_HEADING.test(text)
  );
}

export function pickQuote(
  blocks: QuoteBlock[],
  totalChars: number,
  rand: () => number = Math.random
): QuoteBlock | undefined {
  const lo = totalChars * QUOTE_RANGE.from;
  const hi = totalChars * QUOTE_RANGE.to;
  const pool = blocks.filter((b) => b.pos >= lo && b.pos <= hi && isQuotable(b.text));
  return pool.length ? pool[Math.floor(rand() * pool.length)] : undefined;
}

/**
 * The title a Calibre-style Kindle filename most likely imports as:
 * `局外人 (加缪).azw3` → `局外人`. Strips the extension and any trailing
 * bracketed author groups, half- or full-width.
 */
export function titleFromKindleFilename(name: string): string {
  let stem = name.replace(/\.[^.]+$/, '').trim();
  let prev = '';
  while (prev !== stem) {
    prev = stem;
    stem = stem.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  }
  return stem || name;
}

/**
 * Kindle files not yet in the library.
 *
 * Two independent checks, because neither is enough alone: `imported` holds
 * the documents-relative paths this app has pulled off a Kindle before (the
 * library title comes from the book's metadata and can differ from the
 * filename entirely), and the title match catches books the user had already
 * imported by hand before this feature existed.
 */
export function pendingKindleBooks(
  paths: string[],
  root: string,
  imported: ReadonlySet<string>,
  libraryTitles: ReadonlySet<string>
): string[] {
  return paths.filter((p) => {
    const rel = kindleRelPath(p, root);
    if (imported.has(rel)) return false;
    const name = rel.split('/').pop() || rel;
    const stem = name.replace(/\.[^.]+$/, '').trim();
    return !libraryTitles.has(stem) && !libraryTitles.has(titleFromKindleFilename(name));
  });
}

/** Path under the Kindle root with `/` separators. The drive letter is
 * whatever Windows assigned this time, so it is not part of the identity. */
export function kindleRelPath(path: string, root: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/');
  const r = norm(root).replace(/\/?$/, '/');
  const p = norm(path);
  return p.toLowerCase().startsWith(r.toLowerCase()) ? p.slice(r.length) : p;
}
