import type { DBSchema } from 'idb';
import type BooksDbV9 from '$lib/data/database/books-db/versions/v9/books-db-v9';

/** v10 introduces a title-keyed `bookMetadata` store so bibliographic details
 * (author, publisher, subjects, isbn) survive independent of whether the book
 * is imported from a file or manually recorded as a paper read. Aggregating
 * statistics can join on `title` without touching the heavy `data` store.
 *
 * Manual paper reads with no `data` row still get a metadata row here so
 * stage-4 breakdowns (Top authors etc.) include them. */
export interface BooksDbV10BookMetadata {
  title: string;
  author?: string;
  publisher?: string;
  subjects?: string[];
  isbn?: string;
  language?: string;
  /** Where this metadata came from: file import vs. manual paper entry. */
  source: 'imported' | 'manual';
  lastMetadataModified: number;
}

export default interface BooksDbV10 extends DBSchema {
  data: BooksDbV9['data'];
  bookmark: BooksDbV9['bookmark'];
  lastItem: BooksDbV9['lastItem'];
  storageSource: BooksDbV9['storageSource'];
  statistic: BooksDbV9['statistic'];
  readingGoal: BooksDbV9['readingGoal'];
  lastModified: BooksDbV9['lastModified'];
  audioBook: BooksDbV9['audioBook'];
  subtitle: BooksDbV9['subtitle'];
  handle: BooksDbV9['handle'];
  folder: BooksDbV9['folder'];
  bookFolder: BooksDbV9['bookFolder'];
  highlight: BooksDbV9['highlight'];
  highlightFolder: BooksDbV9['highlightFolder'];
  bookMetadata: {
    key: string;
    value: BooksDbV10BookMetadata;
    indexes: { source: string };
  };
}
