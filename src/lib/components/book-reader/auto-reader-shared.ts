/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Shared helpers used by every AutoReader engine.
 */

const SENTENCE_DELIMITER = /([。！？；.!?;\n]+)/;

export function splitSentences(text: string): string[] {
  const result: string[] = [];
  const parts = text.split(SENTENCE_DELIMITER);
  let buffer = '';
  for (let i = 0; i < parts.length; i++) {
    buffer += parts[i];
    if (SENTENCE_DELIMITER.test(parts[i]) || i === parts.length - 1) {
      const trimmed = buffer.trim();
      if (trimmed) result.push(trimmed);
      buffer = '';
    }
  }
  if (buffer.trim()) result.push(buffer.trim());
  return result;
}

export function extractText(root: HTMLElement): string {
  // 如果 DOM 已被 typewriter 修改，从 .tw-c span 提取以保持索引一致
  const twcSpans = root.querySelectorAll('.tw-c');
  if (twcSpans.length > 0) {
    return Array.from(twcSpans)
      .map((span) => span.textContent || '')
      .join('');
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const parts: string[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE') {
        parts.push(node.textContent || '');
      }
    }
    node = walker.nextNode();
  }
  return parts.join('');
}

export function computeGlobalCharIndex(
  paragraphs: string[],
  paraIndex: number,
  localIndex: number
): number {
  let acc = 0;
  for (let i = 0; i < paraIndex; i++) {
    acc += paragraphs[i].length;
  }
  return acc + localIndex;
}

/**
 * Translate a DOM (node, offset) pair inside the rendered book content into
 * a character index that aligns with extractText() output — so it can feed
 * straight into seekParagraphsToExplored / autoReader.seekToExplored.
 */
export function domPositionToCharIndex(
  root: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number | null {
  // Typewriter wraps every character in its own .tw-c span; if those are
  // present, mirror extractText()'s span-walk so indices line up.
  const twcSpans = root.querySelectorAll('.tw-c');
  if (twcSpans.length > 0) {
    let total = 0;
    for (let i = 0; i < twcSpans.length; i++) {
      const span = twcSpans[i];
      if (span === targetNode || span.contains(targetNode)) {
        return total + targetOffset;
      }
      total += (span.textContent || '').length;
    }
    return total;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE') {
        if (node === targetNode) {
          return total + targetOffset;
        }
        if (node.contains(targetNode)) {
          // Selection inside a descendant of this text node shouldn't happen
          // (text nodes have no element children), but be defensive.
          return total + targetOffset;
        }
        total += (node.textContent || '').length;
      }
    }
    node = walker.nextNode();
  }
  return null;
}

/**
 * Convenience: read the current document selection's start position and map
 * it to a char index inside `root`. Returns null when there's no selection
 * inside the content area.
 */
export function selectionToCharIndex(root: HTMLElement): number | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  return domPositionToCharIndex(root, range.startContainer, range.startOffset);
}

/**
 * The paginated calculator counts characters via getCharacterCount(), which
 * strips whitespace, punctuation and most non-CJK symbols. TTS engines report
 * boundary positions as offsets into the raw extractText() string. Convert
 * one into the other so we can hand a TTS boundary char-index to
 * SectionCharacterStatsCalculator.getScrollPosByCharCount().
 */
const NOT_COUNTED_REGEX =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

export function ttsIndexToCalculatorIndex(extractedText: string, ttsIndex: number): number {
  const slice = extractedText.slice(0, ttsIndex);
  return Array.from(slice.replace(NOT_COUNTED_REGEX, '')).length;
}

export function seekParagraphsToExplored(
  paragraphs: string[],
  exploredCharCount: number
): { paraIndex: number; charOffset: number } {
  let acc = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i].length;
    if (acc + len > exploredCharCount) {
      return { paraIndex: i, charOffset: exploredCharCount - acc };
    }
    acc += len;
  }
  return { paraIndex: paragraphs.length, charOffset: 0 };
}
