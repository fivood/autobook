/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Translate a TTS boundary position into the paginated calculator's space.
 *
 * Two counting rules meet here and they do not agree on what a character is:
 *
 *   * TTS engines report offsets into `extractText()`, which takes every text
 *     node except SCRIPT / STYLE.
 *   * The paginated calculator counts `getParagraphNodes()` — which drops
 *     `<rt>` (furigana), `hidden` and `aria-hidden` subtrees, and adds gaiji
 *     `<img>` elements as one character each — and then strips non-CJK from
 *     what is left.
 *
 * The previous version did the translation on the flat extracted *string*, so
 * it could only apply the second half of that (the character filter) and was
 * blind to the node-level exclusions. Measured with both real implementations:
 * a paragraph with furigana translated to 19 where the calculator counted 14,
 * and a `hidden` span produced the same +5. The error is monotonic within a
 * section — every ruby annotation adds to it — so in a Japanese book the
 * auto-page-flip runs further and further ahead of the voice and never
 * recovers until the section changes.
 *
 * Doing it over the DOM instead means both halves come from the same source of
 * truth: the nodes the calculator would count, walked in the order
 * `extractText()` produced its string.
 */

import { getCharacterCount } from '$lib/functions/get-character-count';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';
import { isNodeGaiji } from '$lib/functions/is-node-gaiji';

/** Same class of character the calculator keeps; everything else is stripped. */
const NOT_COUNTED_REGEX =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

function countedLength(text: string): number {
  return Array.from(text.replace(NOT_COUNTED_REGEX, '')).length;
}

/**
 * Calculator-space index for `ttsIndex`, an offset into `extractText(root)`.
 *
 * Walks in `extractText()` order and adds a node's contribution only when the
 * calculator would have counted that node at all.
 */
export function ttsIndexToCalculatorIndex(root: HTMLElement, ttsIndex: number): number {
  if (ttsIndex <= 0) return 0;

  const counted = new Set<Node>(getParagraphNodes(root));
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null
  );

  let ttsSeen = 0;
  let calc = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // Gaiji images are one character to the calculator and invisible to
      // extractText, so they advance only the calculator side.
      if (counted.has(node) && isNodeGaiji(node)) calc += getCharacterCount(node);
    } else {
      const parent = node.parentElement;
      const tag = parent?.tagName;
      if (parent && tag !== 'SCRIPT' && tag !== 'STYLE') {
        const text = node.textContent || '';
        if (text.length > 0) {
          const take = Math.min(text.length, ttsIndex - ttsSeen);
          if (counted.has(node)) calc += countedLength(text.slice(0, take));
          ttsSeen += take;
          if (ttsSeen >= ttsIndex) return calc;
        }
      }
    }
    node = walker.nextNode();
  }

  return calc;
}
