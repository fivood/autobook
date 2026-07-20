import type { DBSchema } from 'idb';
import type BooksDbV10 from '$lib/data/database/books-db/versions/v10/books-db-v10';

/** v11 adds an optional `hourly` field to statistic rows: a 24-slot array
 * where index i holds the seconds attributed to hour-of-day i for that
 * [title, dateKey]. The tracker updates it as it flushes, and old rows
 * without the field simply contribute nothing to the hour-of-day breakdown.
 * No store or index change — pure additive on the row shape. */

type V10StatisticStore = BooksDbV10['statistic'];
type V10StatisticValue = V10StatisticStore['value'];

export interface BooksDbV11Statistic extends V10StatisticValue {
  hourly?: number[];
}

export default interface BooksDbV11 extends DBSchema {
  data: BooksDbV10['data'];
  bookmark: BooksDbV10['bookmark'];
  lastItem: BooksDbV10['lastItem'];
  storageSource: BooksDbV10['storageSource'];
  statistic: {
    key: V10StatisticStore['key'];
    value: BooksDbV11Statistic;
    indexes: V10StatisticStore['indexes'];
  };
  readingGoal: BooksDbV10['readingGoal'];
  lastModified: BooksDbV10['lastModified'];
  audioBook: BooksDbV10['audioBook'];
  subtitle: BooksDbV10['subtitle'];
  handle: BooksDbV10['handle'];
  folder: BooksDbV10['folder'];
  bookFolder: BooksDbV10['bookFolder'];
  highlight: BooksDbV10['highlight'];
  highlightFolder: BooksDbV10['highlightFolder'];
  bookMetadata: BooksDbV10['bookMetadata'];
}
