/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isNodeGaiji } from '$lib/functions/is-node-gaiji';

export function getParagraphNodes(node: Node) {
  const textNodes = getTextNodeOrGaijiNodes(node, (n) => {
    if (n.nodeName === 'RT') {
      return false;
    }
    const isHidden =
      n instanceof HTMLElement &&
      (n.attributes.getNamedItem('aria-hidden') || n.attributes.getNamedItem('hidden'));
    if (isHidden) {
      return false;
    }
    // The page number the cbz / cbr / pdf loaders print above each page is
    // this app's own chrome. Counting it made it the *entire* measured content
    // of an image book: a 162-page scan with no text layer reported 381
    // characters read, every one of them a page number — and, because those
    // labels are text, they also suppressed the image fallback below that
    // exists to give exactly those books a per-page unit.
    //
    // The comic translation overlay goes with it, for a different reason: it
    // is text this app paints over the artwork, and whether it exists depends
    // on whether the reader has run a translation. Counting it made the same
    // comic measure 163 characters translated and 113 pages untranslated —
    // the progress bar would move to a different scale on the same book.
    if (
      n instanceof HTMLElement &&
      (n.classList.contains('pdf-page-label') || n.classList.contains('comic-translation-overlay'))
    ) {
      return false;
    }
    return true;
  }).filter((n) => {
    if (isNodeGaiji(n)) {
      return true;
    }
    if (n.textContent?.replace(/\s/g, '').length) {
      return true;
    }
    return false;
  });

  if (textNodes.length) return textNodes;

  // Scan-only / fixed-layout EPUBs (old PDF→EPUB conversions) have no text
  // in this section — every page is a single <img> or SVG <image>. Without
  // a "paragraph" node the position tracker can't advance, so the reader
  // stays stuck on the cover. Fall back to image elements so each scan page
  // counts as one unit for scrolling, bookmarks, and progress %. Mixed
  // books (text with occasional inline images) skip this branch and count
  // text only, so their existing progress numbers stay untouched.
  return node instanceof Element
    ? (Array.from(node.querySelectorAll('img, image')) as Node[])
    : [];
}

function getTextNodeOrGaijiNodes(node: Node, filterFn: (n: Node) => boolean): Node[] {
  if (!node.hasChildNodes() || !filterFn(node)) {
    return [];
  }

  return Array.from(node.childNodes)
    .flatMap((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        return [n];
      }
      if (isNodeGaiji(n)) {
        return [n];
      }
      return getTextNodeOrGaijiNodes(n, filterFn);
    })
    .filter(filterFn);
}
