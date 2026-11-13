/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import formatBookDataHtml from './format-book-data-html';
import formatStyleSheet from './format-style-sheet';
import { map, type Subject } from 'rxjs';
import type { LoadProgress } from './load-progress';
import { progress } from './load-progress';

export default function loadBookData(
  bookData: BooksDbBookData,
  parentSelector: string,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode,
  progress$?: Subject<LoadProgress>
) {
  return formatBookDataHtml(bookData, document, isPaginated, blurMode, progress$).pipe(
    map(({ htmlContent, objectUrls }) => {
      progress$?.next(progress('stylesheet', 90));
      const styleSheet = formatStyleSheet(bookData, parentSelector);
      progress$?.next(progress('render', 95));
      return {
        htmlContent,
        styleSheet,
        language: bookData.language,
        objectUrls
      };
    })
  );
}
