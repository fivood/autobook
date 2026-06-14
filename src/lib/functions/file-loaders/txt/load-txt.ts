/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LoadData } from '$lib/functions/file-loaders/types';
import extractTxt from '$lib/functions/file-loaders/txt/extract-txt';
import { getFormattedElementTxt } from '$lib/functions/file-loaders/txt/generate-txt-html';

function detectLanguage(text: string): string {
  const sample = text.slice(0, 2000);
  const hiragana = (sample.match(/[\u3040-\u309F]/g) || []).length;
  const katakana = (sample.match(/[\u30A0-\u30FF]/g) || []).length;
  const cjk = (sample.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;

  if (hiragana + katakana > 10) return 'ja';
  if (latin > cjk) return 'en';
  return 'zh';
}

export default async function loadTxt(file: File, lastBookModified: number): Promise<LoadData> {
  const data = await extractTxt(file);
  const { element, characters, sections } = getFormattedElementTxt(data);

  return {
    title: file.name,
    language: detectLanguage(data),
    styleSheet: '',
    elementHtml: element.innerHTML,
    blobs: {},
    coverImage: undefined,
    hasThumb: false,
    characters,
    sections,
    lastBookModified,
    lastBookOpen: 0
  };
}
