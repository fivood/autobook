import type { DBSchema } from 'idb';
import type BooksDbV7 from '$lib/data/database/books-db/versions/v7/books-db-v7';

export type HighlightColor = 'yellow' | 'blue' | 'green' | 'pink';

export interface BooksDbV8Highlight {
  id: number;
  dataId: number;
  bookTitle: string;
  startOffset: number;
  endOffset: number;
  text: string;
  memo: string;
  color: HighlightColor;
  createdAt: number;
  lastModified: number;
  tags?: string[];
  kind?: 'note';
}

export default interface BooksDbV8 extends DBSchema {
  data: BooksDbV7['data'];
  bookmark: BooksDbV7['bookmark'];
  lastItem: BooksDbV7['lastItem'];
  storageSource: BooksDbV7['storageSource'];
  statistic: BooksDbV7['statistic'];
  readingGoal: BooksDbV7['readingGoal'];
  lastModified: BooksDbV7['lastModified'];
  audioBook: BooksDbV7['audioBook'];
  subtitle: BooksDbV7['subtitle'];
  handle: BooksDbV7['handle'];
  folder: BooksDbV7['folder'];
  bookFolder: BooksDbV7['bookFolder'];
  highlight: {
    key: number;
    value: BooksDbV8Highlight;
    indexes: { dataId: number; dataIdStartOffset: [number, number] };
  };
}
