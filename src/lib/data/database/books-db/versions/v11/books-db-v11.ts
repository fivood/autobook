import type { DBSchema } from 'idb';
import type BooksDbV10 from '$lib/data/database/books-db/versions/v10/books-db-v10';

/**
 * Metadata for a manually-entered book (physical or otherwise). Keyed by
 * title — same key space the `statistic` table uses, so a title's daily
 * rows and its metadata line up naturally.
 *
 * `coverBlob` is stored as a raw Blob (IDB handles binary directly); the
 * frontend renders via `URL.createObjectURL` and revokes on unmount.
 * `totalCharacters` is the planned total (from the printed book's
 * character-count listing or a manual estimate) so the reader can show
 * a % progress bar against the sum of daily `charactersRead` rows.
 * `tags` is a free-form array — reused by the future books/authors
 * explorer tabs and by notebook filtering.
 */
export interface BooksDbV11ManualBook {
  title: string;
  author?: string;
  translator?: string;
  publisher?: string;
  publishedYear?: number;
  isbn?: string;
  totalCharacters?: number;
  tags?: string[];
  coverBlob?: Blob;
  coverMime?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export default interface BooksDbV11 extends DBSchema {
  data: BooksDbV10['data'];
  bookmark: BooksDbV10['bookmark'];
  lastItem: BooksDbV10['lastItem'];
  storageSource: BooksDbV10['storageSource'];
  statistic: BooksDbV10['statistic'];
  readingGoal: BooksDbV10['readingGoal'];
  lastModified: BooksDbV10['lastModified'];
  audioBook: BooksDbV10['audioBook'];
  subtitle: BooksDbV10['subtitle'];
  handle: BooksDbV10['handle'];
  folder: BooksDbV10['folder'];
  bookFolder: BooksDbV10['bookFolder'];
  highlight: BooksDbV10['highlight'];
  highlightFolder: BooksDbV10['highlightFolder'];
  session: BooksDbV10['session'];
  manualBook: {
    key: string;
    value: BooksDbV11ManualBook;
    indexes: {
      author: string;
      updatedAt: number;
    };
  };
}
