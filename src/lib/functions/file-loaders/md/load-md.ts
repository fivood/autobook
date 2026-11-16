/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import type { LoadData } from '$lib/functions/file-loaders/types';
import { getFormattedElementMd } from '$lib/functions/file-loaders/md/generate-md-html';
import { detectLanguage } from '$lib/functions/file-loaders/detect-language';
import { detectAndDecode } from '$lib/functions/file-loaders/txt/extract-txt';


async function readAsText(file: File): Promise<string> {
  // Try UTF-8 first; if it lands on the U+FFFD replacement char a lot, the
  // file is in a legacy encoding — detect it the way TXT does (Korean CP949,
  // Shift-JIS, GB18030, Big5) instead of assuming GBK.
  const utf8 = await file.text();
  const replacements = (utf8.match(/�/g) || []).length;
  if (replacements < 5) return utf8;
  try {
    return detectAndDecode(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return utf8;
  }
}

export default async function loadMd(file: File, lastBookModified: number): Promise<LoadData> {
  const data = await readAsText(file);
  const { element, characters, sections } = getFormattedElementMd(data);

  return {
    title: file.name,
    language: detectLanguage(data),
    styleSheet: '',
    elementHtml: element.innerHTML,
    sourceText: data,
    blobs: {},
    coverImage: undefined,
    hasThumb: false,
    characters,
    sections,
    lastBookModified,
    lastBookOpen: 0
  };
}
