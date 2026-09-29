/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LoadData } from '$lib/functions/file-loaders/types';
import extractTxt from '$lib/functions/file-loaders/txt/extract-txt';
import { getFormattedElementTxt } from '$lib/functions/file-loaders/txt/generate-txt-html';
import { detectLanguage } from '$lib/functions/file-loaders/detect-language';


export default async function loadTxt(file: File, lastBookModified: number): Promise<LoadData> {
  const data = await extractTxt(file);
  const { element, characters, sections } = getFormattedElementTxt(data);

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
