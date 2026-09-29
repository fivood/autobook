/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';

/**
 * Bibliographic fields a loader can read out of a book's own metadata block
 * (EPUB OPF `dc:*`, later MOBI EXTH etc.). Kept out of `BooksDbBookData`
 * because the `data` store is the heavy one — elementHtml plus every blob —
 * and the statistics aggregations must be able to join on author/publisher
 * without loading any of that.
 */
export interface ExtractedBookMetadata {
  author?: string;
  publisher?: string;
  subjects?: string[];
  isbn?: string;
  language?: string;
  publishedYear?: number;
}

export interface LoadData extends Omit<BooksDbBookData, 'id'> {
  coverImage: Blob | undefined;
  /**
   * Side channel: populated by the loader, consumed by the import path to
   * write the `bookMetadata` store, and stripped before the row reaches
   * `data`. Underscore-prefixed as a reminder that it is not persisted here.
   */
  _extractedMetadata?: ExtractedBookMetadata;
}
