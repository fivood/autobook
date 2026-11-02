/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * In-book text search, for finding where a printed copy is up to: type a
 * phrase from the page in hand and land on it. Pure (no DOM / IDB) so `npm
 * test` runs it under plain node.
 *
 * Matching runs on the characters the reader counts — letters and ideographs,
 * nothing else (`isCounted`, the `getCharacterCount` basis). That does two
 * jobs at once: a phrase typed from paper still matches when its punctuation,
 * spacing or quote style differs from the ebook's, and a match's offset in the
 * counted text IS its reader position, so it goes straight to
 * `scrollToBookmark` with no conversion.
 */

export interface SearchBlock {
  text: string;
  /** Reader character count at the block's start. */
  pos: number;
}

export interface SearchHit {
  /** Reader character count at the start of the match. */
  pos: number;
  before: string;
  match: string;
  after: string;
}

const CONTEXT = 30;

export function searchBook(
  blocks: SearchBlock[],
  query: string,
  isCounted: (ch: string) => boolean,
  limit = 200
): SearchHit[] {
  const needle = Array.from(query.toLowerCase()).filter(isCounted).join('');
  if (!needle) return [];
  const needleLen = Array.from(needle).length;

  const hits: SearchHit[] = [];
  for (const block of blocks) {
    const chars = Array.from(block.text);
    // Counted characters of the block, and where each sits in `chars`.
    const kept: string[] = [];
    const at: number[] = [];
    chars.forEach((ch, i) => {
      if (isCounted(ch)) {
        kept.push(ch.toLowerCase());
        at.push(i);
      }
    });
    const hay = kept.join('');

    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      // indexOf works in UTF-16 units; positions are in code points.
      const start = Array.from(hay.slice(0, idx)).length;
      const end = start + needleLen - 1;
      const a = at[start];
      const b = at[end] + 1;
      hits.push({
        pos: block.pos + start,
        before: (a > CONTEXT ? '…' : '') + chars.slice(Math.max(0, a - CONTEXT), a).join(''),
        match: chars.slice(a, b).join(''),
        after: chars.slice(b, b + CONTEXT).join('') + (chars.length > b + CONTEXT ? '…' : '')
      });
      if (hits.length >= limit) return hits;
      from = idx + needle.length;
    }
  }
  return hits;
}
