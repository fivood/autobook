import type { DBSchema } from 'idb';
import type BooksDbV8 from '$lib/data/database/books-db/versions/v8/books-db-v8';
import type { BooksDbV8Highlight, HighlightColor } from '$lib/data/database/books-db/versions/v8/books-db-v8';

export type { HighlightColor };

export interface BooksDbV9Highlight extends BooksDbV8Highlight {
  folderId?: number;
  linkedIds?: number[];
  lastReviewedAt?: number;
}

export interface BooksDbV9HighlightFolder {
  id: number;
  name: string;
  parentId?: number;
  sortOrder: number;
  createdAt: number;
  lastModified: number;
}

export default interface BooksDbV9 extends DBSchema {
  data: BooksDbV8['data'];
  bookmark: BooksDbV8['bookmark'];
  lastItem: BooksDbV8['lastItem'];
  storageSource: BooksDbV8['storageSource'];
  statistic: BooksDbV8['statistic'];
  readingGoal: BooksDbV8['readingGoal'];
  lastModified: BooksDbV8['lastModified'];
  audioBook: BooksDbV8['audioBook'];
  subtitle: BooksDbV8['subtitle'];
  handle: BooksDbV8['handle'];
  folder: BooksDbV8['folder'];
  bookFolder: BooksDbV8['bookFolder'];
  highlight: {
    key: number;
    value: BooksDbV9Highlight;
    indexes: { dataId: number; dataIdStartOffset: [number, number] };
  };
  highlightFolder: {
    key: number;
    value: BooksDbV9HighlightFolder;
    indexes: { sortOrder: number };
  };
}
