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
