import type { DBSchema } from 'idb';
import type BooksDbV9 from '$lib/data/database/books-db/versions/v9/books-db-v9';

/**
 * A single uninterrupted stretch of active tracker time. Written by the
 * book-reading-tracker on pause / unmount when duration >= a small floor
 * (30s). Uses raw epoch timestamps (not day-split) so downstream aggregation
 * can bin by hour-of-day, day, week, or month without losing information.
 *
 * `dateKey` is the *start-of-session* date under the user's configured
 * `startDayHoursForTracker` (an offset that lets "day X" run e.g. 04:00→04:00);
 * kept as an index so per-year / per-month queries stay a single IDB range scan.
 */
export interface BooksDbV10Session {
  id: number;
  title: string;
  startTs: number;
  endTs: number;
  durationSec: number;
  charsRead: number;
  dateKey: string;
  sectionsRead?: number;
  deviceId?: string;
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
  session: {
    key: number;
    value: BooksDbV10Session;
    indexes: {
      dateKey: string;
      title: string;
      startTs: number;
    };
  };
}
