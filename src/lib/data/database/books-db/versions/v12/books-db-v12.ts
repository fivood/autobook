import type { DBSchema } from 'idb';
import type BooksDbV11 from '$lib/data/database/books-db/versions/v11/books-db-v11';

/**
 * Bibliographic metadata read out of an imported file's own metadata block
 * (EPUB OPF `dc:*`, and later MOBI EXTH etc.). Keyed by `title` — the same
 * key space `statistic` and `manualBook` use — so the statistics aggregations
 * can join on it without touching the heavy `data` store (elementHtml +
 * blobs), which is the whole point of keeping it separate.
 *
 * Deliberately imported-only. `manualBook` already holds the user-entered
 * side, and the two must not share a row: re-importing a file would silently
 * overwrite fields the user typed by hand. Consumers read `manualBook` first
 * and fall back here, so a manual correction always wins over what the file
 * claimed.
 *
 * Every field except `title` / `importedAt` is optional because real EPUBs
 * omit most of Dublin Core. An absent field means "the file didn't say", not
 * "empty" — merge logic must never let an absent value clear a stored one.
 */
export interface BooksDbV12BookMetadata {
  title: string;
  author?: string;
  publisher?: string;
  subjects?: string[];
  isbn?: string;
  language?: string;
  publishedYear?: number;
  importedAt: number;
}

export default interface BooksDbV12 extends DBSchema {
  data: BooksDbV11['data'];
  bookmark: BooksDbV11['bookmark'];
  lastItem: BooksDbV11['lastItem'];
  storageSource: BooksDbV11['storageSource'];
  statistic: BooksDbV11['statistic'];
  readingGoal: BooksDbV11['readingGoal'];
  lastModified: BooksDbV11['lastModified'];
  audioBook: BooksDbV11['audioBook'];
  subtitle: BooksDbV11['subtitle'];
  handle: BooksDbV11['handle'];
  folder: BooksDbV11['folder'];
  bookFolder: BooksDbV11['bookFolder'];
  highlight: BooksDbV11['highlight'];
  highlightFolder: BooksDbV11['highlightFolder'];
  session: BooksDbV11['session'];
  manualBook: BooksDbV11['manualBook'];
  bookMetadata: {
    key: string;
    value: BooksDbV12BookMetadata;
    indexes: {
      author: string;
    };
  };
}
