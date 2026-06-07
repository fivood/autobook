/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Section } from '$lib/data/database/books-db/versions/books-db';
import { getCharacterCount } from '$lib/functions/get-character-count';

const CHAPTER_PATTERNS: RegExp[] = [
  // 中文：第X章/节/節/回/卷/部/篇  (可带 X 为汉数字、阿拉伯数字、全角数字)
  /^第[零〇一二两三四五六七八九十百千万亿0-9０-９]+\s*[章节節回卷部篇编編](\s|$|[：:、，,．.\-—].*)/,
  // 特殊章节
  /^(序章|序言|序幕|楔子|引子|前言|序|后记|後記|尾声|尾聲|番外篇?|外传|外傳|附录|附錄|跋|终章|終章|致谢|致謝|结语|結語|致读者)(\s.*)?$/,
  // 英文 Chapter / Section / Part / Prologue / Epilogue
  /^(chapter|section|part|prologue|epilogue)\s+[ivxlcdm\d]+([:：.\s].*)?$/i,
  // 纯阿拉伯数字独立成行（粗体章节号的常见形态）
  /^[\d０-９]{1,4}$/,
  // 纯中文数字独立成行（一/二/十/百…）
  /^[零〇一二两三四五六七八九十百千]{1,5}$/
];

function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  for (let i = 0; i < CHAPTER_PATTERNS.length; i += 1) {
    if (CHAPTER_PATTERNS[i].test(trimmed)) return true;
  }
  return false;
}

export function getFormattedElementTxt(data: string) {
  const result = document.createElement('div');
  const punctuationRegex = /[。.）」？！!?]+/;
  const lines = data.split(/\r?\n/);
  const sections: Section[] = [];

  let sectionIndex = 0;
  let currentChildDiv = document.createElement('div');
  let currentSectionId = `section-${sectionIndex + 1}`;
  let currentSectionLabel = '';
  let currentSectionLength = 0;
  let currentSectionCharCount = 0;
  let currentParagraphContent = '';
  let totalCharCount = 0;
  let hasContentInCurrent = false;

  sectionIndex += 1;
  currentChildDiv.id = currentSectionId;

  function flushParagraph() {
    if (!currentParagraphContent.length) return;
    const paragraph = document.createElement('p');
    paragraph.innerText = currentParagraphContent;
    const len = currentParagraphContent.length;
    currentSectionLength += len;
    currentSectionCharCount += len;
    totalCharCount += len;
    currentChildDiv.appendChild(paragraph);
    currentParagraphContent = '';
    hasContentInCurrent = true;
  }

  function commitSection() {
    if (!hasContentInCurrent) return;
    sections.push({
      reference: currentSectionId,
      charactersWeight: currentSectionCharCount || 1,
      label: currentSectionLabel || currentSectionId,
      startCharacter: totalCharCount - currentSectionCharCount,
      characters: currentSectionCharCount
    });
    result.appendChild(currentChildDiv);
  }

  function startNewSection(label: string) {
    commitSection();
    sectionIndex += 1;
    currentChildDiv = document.createElement('div');
    currentSectionId = `section-${sectionIndex}`;
    currentChildDiv.id = currentSectionId;
    currentSectionLabel = label;
    currentSectionLength = 0;
    currentSectionCharCount = 0;
    hasContentInCurrent = false;

    if (label) {
      const heading = document.createElement('h2');
      heading.innerText = label;
      currentChildDiv.appendChild(heading);
      const len = label.length;
      currentSectionCharCount += len;
      totalCharCount += len;
      hasContentInCurrent = true;
    }
  }

  for (let index = 0, { length } = lines; index < length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (!trimmed.length) {
      flushParagraph();
      const br = document.createElement('br');
      currentChildDiv.appendChild(br);
      continue;
    }

    if (isChapterHeading(trimmed)) {
      flushParagraph();
      startNewSection(trimmed);
      continue;
    }

    const characters = [...trimmed];

    if (characters.length < 350) {
      currentParagraphContent += trimmed;
      flushParagraph();
    } else {
      for (let i = 0; i < characters.length; i += 1) {
        let character = characters[i];
        let isPunctuation = punctuationRegex.test(character);
        const wasPunctuation = isPunctuation;
        while (isPunctuation) {
          currentParagraphContent += character;
          i += 1;
          character = characters[i] || '';
          isPunctuation = punctuationRegex.test(character);
          if (!isPunctuation) {
            character = '';
            i -= 1;
          }
        }
        currentParagraphContent += character;
        if (wasPunctuation || i > characters.length - 1) {
          flushParagraph();
        }
      }
    }

    // 兜底：单一无章节标题的极长段落仍按 ~10000 字符机械切分
    if (currentSectionLength > 10000) {
      startNewSection('');
    }
  }

  flushParagraph();
  commitSection();

  return {
    element: result,
    characters: getCharacterCount(result),
    sections
  };
}
