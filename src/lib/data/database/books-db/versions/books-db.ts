/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDbV12 from '$lib/data/database/books-db/versions/v12/books-db-v12';

export type { Section } from '$lib/data/database/books-db/versions/v6/books-db-v6';
export type {
  BooksDbV7Folder as BooksDbFolder,
  BooksDbV7BookFolder as BooksDbBookFolder
} from '$lib/data/database/books-db/versions/v7/books-db-v7';
export type { HighlightColor } from '$lib/data/database/books-db/versions/v8/books-db-v8';
export type {
  BooksDbV9Highlight as BooksDbHighlight,
  BooksDbV9HighlightFolder as BooksDbHighlightFolder
} from '$lib/data/database/books-db/versions/v9/books-db-v9';
export type { BooksDbV10Session as BooksDbSession } from '$lib/data/database/books-db/versions/v10/books-db-v10';
export type { BooksDbV11ManualBook as BooksDbManualBook } from '$lib/data/database/books-db/versions/v11/books-db-v11';
export type { BooksDbV12BookMetadata as BooksDbBookMetadata } from '$lib/data/database/books-db/versions/v12/books-db-v12';

type BooksDb = BooksDbV12;

export type BooksDbBookData = BooksDb['data']['value'];
export type BooksDbBookmarkData = BooksDb['bookmark']['value'];
export type BooksDbStorageSource = BooksDb['storageSource']['value'];
export type BooksDbStatistic = BooksDb['statistic']['value'];
export type BooksDbReadingGoal = BooksDb['readingGoal']['value'];
export type BooksDbLastModified = BooksDb['lastModified']['value'];
export type BooksDbAudioBook = BooksDb['audioBook']['value'];
export type BooksDbSubtitleData = BooksDb['subtitle']['value'];
export type BooksDbHandle = BooksDb['handle']['value'];
export const currentDbVersion = 12;

export type { BooksDb as default };
