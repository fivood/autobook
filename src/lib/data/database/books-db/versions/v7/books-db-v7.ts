/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * v7 adds library folders (categories). A book can belong to many folders
 * (tag-style), so `bookFolder` is a many-to-many junction. The existing
 * `data` rows are NOT mutated — books continue to exist without folders.
 */

import type { DBSchema } from 'idb';
import type BooksDbV6 from '$lib/data/database/books-db/versions/v6/books-db-v6';
import type { BookCardId } from '$lib/data/book-id';

export interface BooksDbV7Folder {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: number;
  /** `'local'` = mirrored from a directory during a folder import, where the
   * name is the relative path inside the picked folder (`读书/技术`). Absent
   * = created by hand in the reader. Only affects grouping in the sidebar;
   * optional so existing rows need no migration. */
  source?: 'local';
}

export interface BooksDbV7BookFolder {
  /** Library-card id, not the IDB `data.id` — under external file storage
   * these differ. Means folder assignments are scoped to the storage source
   * they were made under; see book-id.ts. */
  bookId: BookCardId;
  folderId: number;
  addedAt: number;
}

export default interface BooksDbV7 extends DBSchema {
  data: BooksDbV6['data'];
  bookmark: BooksDbV6['bookmark'];
  lastItem: BooksDbV6['lastItem'];
  storageSource: BooksDbV6['storageSource'];
  statistic: BooksDbV6['statistic'];
  readingGoal: BooksDbV6['readingGoal'];
  lastModified: BooksDbV6['lastModified'];
  audioBook: BooksDbV6['audioBook'];
  subtitle: BooksDbV6['subtitle'];
  handle: BooksDbV6['handle'];
  folder: {
    key: number;
    value: BooksDbV7Folder;
    indexes: { sortOrder: number };
  };
  bookFolder: {
    key: [number, number];
    value: BooksDbV7BookFolder;
    indexes: { bookId: number; folderId: number };
  };
}
