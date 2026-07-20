/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';

/** Transient metadata a loader may extract from a book's own metadata blocks
 * (EPUB OPF, MOBI EXTH, etc.) that doesn't belong inside `BooksDbBookData` but
 * should be persisted separately into the `bookMetadata` store after import. */
export interface ExtractedBookMetadata {
  author?: string;
  publisher?: string;
  subjects?: string[];
  isbn?: string;
  language?: string;
}

export interface LoadData extends Omit<BooksDbBookData, 'id'> {
  coverImage: Blob | undefined;
  /** Loader-populated; consumed by the import path to write `bookMetadata`
   * and NOT persisted into the `data` store. */
  _extractedMetadata?: ExtractedBookMetadata;
}
