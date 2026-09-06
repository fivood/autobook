/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Period-scoped per-book + per-author aggregation. Powers the books /
 * authors explorer tabs (Phase C, 1.20.4).
 *
 * Data comes from five IDB sources:
 *   - `statistic`    daily rollup rows (time / chars / completed marker)
 *   - `manualBook`   per-title metadata the user typed (author / translator /
 *                    publisher / totalCharacters / cover)
 *   - `bookMetadata` the same bibliographic fields, but parsed out of an
 *                    imported file's OPF. manualBook wins field by field:
 *                    a hand correction must survive a re-import.
 *   - `data`         imported books (metadata like `characters` used as
 *                    fallback totalCharacters when manualBook missing)
 *   - `session`      unused here — those live in the sessions tab
 *
 * Books without any statistic row in the period are omitted; that
 * matches how the summary / heatmap tabs already scope.
 */

import type {
  BooksDbBookData,
  BooksDbBookMetadata,
  BooksDbManualBook,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import type { PeriodBounds } from './statistics-period';

export interface BookRow {
  title: string;
  seconds: number;
  chars: number;
  days: number;
  /** Sum of `completedBook` markers in the period — usually 0 or 1. */
  completed: number;
  /** manualBook.totalCharacters wins over data.characters. */
  totalCharacters?: number;
  progress: number;
  author?: string;
  translator?: string;
  publisher?: string;
  publishedYear?: number;
  coverBlob?: Blob;
  tags?: string[];
  /** Most recent dateKey with reading time in the period. */
  lastDateKey?: string;
  hasManualBook: boolean;
}

export interface AuthorRow {
  author: string;
  books: string[];
  seconds: number;
  chars: number;
  days: number;
  completed: number;
}

export interface BooksAuthorsInput {
  period: PeriodBounds;
  statistics: BooksDbStatistic[];
  manualBooks: BooksDbManualBook[];
  /** Parsed from imported files; used only where manualBook has no value. */
  bookMetadata?: BooksDbBookMetadata[];
  /** Only the (title, characters) subset — full BookData is heavy. */
  dataMetas: Pick<BooksDbBookData, 'title' | 'characters'>[];
  titleFilter?: Map<string, boolean>;
}

/** Internal sentinel — render-side turns this into i18n label. */
export const UNKNOWN_AUTHOR_KEY = '__unknown_author__';

export function computeBooksList(input: BooksAuthorsInput): BookRow[] {
  const { period, statistics, manualBooks, bookMetadata, dataMetas, titleFilter } = input;
  const passesTitle = (t: string) =>
    !titleFilter || titleFilter.size === 0 || titleFilter.get(t) === true;

  // Per-title aggregation across the period.
  const agg = new Map<
    string,
    { seconds: number; chars: number; days: Set<string>; completed: number; lastDateKey: string }
  >();
  for (const s of statistics) {
    if (
      s.dateKey < period.startDateKey ||
      s.dateKey > period.endDateKey ||
      !passesTitle(s.title)
    ) {
      continue;
    }
    let bucket = agg.get(s.title);
    if (!bucket) {
      bucket = { seconds: 0, chars: 0, days: new Set(), completed: 0, lastDateKey: '' };
      agg.set(s.title, bucket);
    }
    bucket.seconds += s.readingTime || 0;
    bucket.chars += s.charactersRead || 0;
    if (s.readingTime) {
      bucket.days.add(s.dateKey);
      if (s.dateKey > bucket.lastDateKey) bucket.lastDateKey = s.dateKey;
    }
    if (s.completedBook) bucket.completed += s.completedBook;
  }

  // Fast lookup by title.
  const manualByTitle = new Map<string, BooksDbManualBook>();
  for (const m of manualBooks) manualByTitle.set(m.title, m);
  const importedByTitle = new Map<string, BooksDbBookMetadata>();
  for (const m of bookMetadata ?? []) importedByTitle.set(m.title, m);
  const dataCharsByTitle = new Map<string, number>();
  for (const d of dataMetas) {
    if (d.characters) dataCharsByTitle.set(d.title, d.characters);
  }

  const rows: BookRow[] = [];
  for (const [title, bucket] of agg) {
    const manual = manualByTitle.get(title);
    const imported = importedByTitle.get(title);
    const totalCharacters = manual?.totalCharacters ?? dataCharsByTitle.get(title);
    const progress =
      totalCharacters && totalCharacters > 0
        ? Math.min(1, bucket.chars / totalCharacters)
        : 0;
    rows.push({
      title,
      seconds: bucket.seconds,
      chars: bucket.chars,
      days: bucket.days.size,
      completed: bucket.completed,
      totalCharacters,
      progress,
      // Field-level fallback, not row-level: a manualBook row created just
      // to record a page count shouldn't blank out the author the file knew.
      author: manual?.author || imported?.author,
      translator: manual?.translator,
      publisher: manual?.publisher || imported?.publisher,
      publishedYear: manual?.publishedYear ?? imported?.publishedYear,
      coverBlob: manual?.coverBlob,
      tags: manual?.tags?.length ? manual.tags : imported?.subjects,
      lastDateKey: bucket.lastDateKey || undefined,
      hasManualBook: !!manual
    });
  }

  // Default sort: longest reading time first.
  rows.sort((a, b) => b.seconds - a.seconds);
  return rows;
}

export function computeAuthorsList(input: BooksAuthorsInput): AuthorRow[] {
  const books = computeBooksList(input);
  const buckets = new Map<
    string,
    { books: Set<string>; seconds: number; chars: number; days: Set<string>; completed: number }
  >();

  for (const book of books) {
    const key = book.author?.trim() || UNKNOWN_AUTHOR_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { books: new Set(), seconds: 0, chars: 0, days: new Set(), completed: 0 };
      buckets.set(key, bucket);
    }
    bucket.books.add(book.title);
    bucket.seconds += book.seconds;
    bucket.chars += book.chars;
    bucket.completed += book.completed;
    if (book.lastDateKey) bucket.days.add(book.lastDateKey);
  }

  const rows: AuthorRow[] = [];
  for (const [author, bucket] of buckets) {
    rows.push({
      author,
      books: [...bucket.books].sort(),
      seconds: bucket.seconds,
      chars: bucket.chars,
      days: bucket.days.size,
      completed: bucket.completed
    });
  }
  rows.sort((a, b) => b.seconds - a.seconds);
  return rows;
}
