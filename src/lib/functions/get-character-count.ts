/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isNodeGaiji } from './is-node-gaiji';
import { isCountedCharacter, isNotCountedRegex } from './counted-character';

export function getCharacterCount(node: Node) {
  if (isNodeGaiji(node)) return 1;
  // Image-only fallback path from getParagraphNodes: each scan page counts
  // as one unit so the position tracker can step across image-only EPUBs.
  // `localName` is lowercase for both HTML <img> and SVG <image>.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const local = (node as Element).localName;
    if (local === 'img' || local === 'image') return 1;
  }
  return getRawCharacterCount(node);
}

export { isCountedCharacter };

function getRawCharacterCount(node: Node) {
  if (!node.textContent) return 0;
  return countUnicodeCharacters(node.textContent.replace(isNotCountedRegex, ''));
}

/**
 * Because '𠮟る'.length = 3
 * Reference: https://dmitripavlutin.com/what-every-javascript-developer-should-know-about-unicode/#length-and-surrogate-pairs
 */
function countUnicodeCharacters(s: string) {
  return Array.from(s).length;
}
