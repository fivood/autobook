/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Map a character index in `extractText()`'s space back to the element that
 * renders it.
 *
 * Its own module for two reasons: it is the third walk in the codebase that
 * has to agree with `extractText()` character-for-character (the other two are
 * `extractText` itself and TtsHighlighter.prepare), and until now it was
 * buried inline in `b/+page.svelte` where nothing could test it.
 *
 * It did not agree, in three ways that compounded into the worst
 * reading-position bug the app has had:
 *
 *   * empty text nodes were counted. The whitespace between `</p>` and `<p>`
 *     is a zero-length text node whose parent is the *wrapper*, so it could
 *     satisfy the match and hand back a container instead of a paragraph.
 *   * SCRIPT / STYLE text was counted, which `extractText()` drops.
 *   * `total + len >= idx` gave an index sitting exactly on a node boundary
 *     to the node that *ends* there rather than the one that contains it —
 *     and a sentence starting a paragraph is precisely that index.
 *
 * Measured on a real book: 599 of 600 paragraph starts resolved to the wrong
 * element, always earlier, by as much as 65 blocks. Where that element was a
 * chapter wrapper `<div>` — one of them 76042px tall in an 860px viewport —
 * scrolling it into view with `block: 'center'` threw the reader tens of
 * thousands of pixels into text they had not read, and the next sentence,
 * whose index falls strictly inside a paragraph, scrolled back.
 */

/**
 * The element containing `globalIdx`, or null when the index is past the end.
 *
 * `globalIdx` is an offset into the string `extractText(root)` returns, so the
 * walk below must mirror it exactly: same order, same exclusions, same
 * lengths.
 */
export function elementForCharIndex(root: HTMLElement, globalIdx: number): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    const tag = parent?.tagName;
    if (parent && tag !== 'SCRIPT' && tag !== 'STYLE') {
      const text = node.textContent || '';
      if (text.length > 0) {
        // Strictly inside: an index equal to `total + text.length` belongs to
        // the next node, not this one.
        if (globalIdx < total + text.length) return parent;
        total += text.length;
      }
    }
    node = walker.nextNode();
  }
  return null;
}
