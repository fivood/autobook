import type { DBSchema } from 'idb';
import type BooksDbV13 from '$lib/data/database/books-db/versions/v13/books-db-v13';

/**
 * A book the user put away: finished, or abandoned, and in either case not
 * wanted in the library grid any more.
 *
 * Keyed by **title**, deliberately — not by a book id. There are two id
 * spaces in this app (IDB autoincrement for browser-stored books, a title
 * hash for filesystem ones), and a book that gets deleted and re-imported
 * comes back with a different autoincrement id. Title is the one identity
 * that survives all of that, and it is what `statistic`, `session`,
 * `manualBook` and `bookMetadata` already key on.
 */
export interface BooksDbV14Archived {
  title: string;
  archivedAt: number;
}

export default interface BooksDbV14 extends DBSchema {
  data: BooksDbV13['data'];
  bookmark: BooksDbV13['bookmark'];
  lastItem: BooksDbV13['lastItem'];
  storageSource: BooksDbV13['storageSource'];
  statistic: BooksDbV13['statistic'];
  readingGoal: BooksDbV13['readingGoal'];
  lastModified: BooksDbV13['lastModified'];
  audioBook: BooksDbV13['audioBook'];
  subtitle: BooksDbV13['subtitle'];
  handle: BooksDbV13['handle'];
  folder: BooksDbV13['folder'];
  bookFolder: BooksDbV13['bookFolder'];
  highlight: BooksDbV13['highlight'];
  highlightFolder: BooksDbV13['highlightFolder'];
  session: BooksDbV13['session'];
  manualBook: BooksDbV13['manualBook'];
  bookMetadata: BooksDbV13['bookMetadata'];
  archived: {
    key: string;
    value: BooksDbV14Archived;
    indexes: { archivedAt: number };
  };
}
