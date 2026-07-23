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
