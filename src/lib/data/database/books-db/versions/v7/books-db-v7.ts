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

export interface BooksDbV7Folder {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: number;
}

export interface BooksDbV7BookFolder {
  bookId: number;
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
