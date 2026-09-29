/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Period-scoped per-day aggregation for the new SUMMARY tab (1.20.5).
 * Complements BOOKS (per-title) and AUTHORS (per-author) — this one is
 * the daily rhythm view. Each row is a day with time / chars / speed /
 * completed books, plus the per-title breakdown that fed it.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { PeriodBounds } from './statistics-period';

export interface DailyTitleContribution {
  title: string;
  readingTime: number;
  charactersRead: number;
  lastReadingSpeed: number;
  completedBook: number;
  raw: BooksDbStatistic;
}

export interface DailySummaryRow {
  dateKey: string;
  seconds: number;
  chars: number;
  /** Pages, for books whose unit of reading is a page (scans, comics). Kept
   * apart from `chars` because the two cannot be added: a page is not a
   * character, and summing them produced a 「总字数」 that silently mixed
   * 113 comic pages into a novel's word count. */
  pages: number;
  /** Average per-title speed weighted by chars — matches how MAIN
   * computes it. Zero when the day has no character-read data. */
  weightedSpeedCharsPerHour: number;
  titles: DailyTitleContribution[];
  completedBooks: number;
}

export interface DailySummary {
  rows: DailySummaryRow[];
  totalSeconds: number;
  totalChars: number;
  /** Pages read across the period; see DailySummaryRow.pages. */
  totalPages: number;
  totalCompleted: number;
  activeDays: number;
}

export interface DailyInput {
  period: PeriodBounds;
  statistics: BooksDbStatistic[];
  titleFilter?: Map<string, boolean>;
}

export function computeDailySummary(input: DailyInput): DailySummary {
  const { period, statistics, titleFilter } = input;
  const passesTitle = (t: string) =>
    !titleFilter || titleFilter.size === 0 || titleFilter.get(t) === true;

  const byDay = new Map<string, DailySummaryRow>();
  let totalSeconds = 0;
  let totalChars = 0;
  let totalPages = 0;
  let totalCompleted = 0;

  /** A row measured in pages: the tracker recorded a page total for it. */
  const pagesOf = (s: BooksDbStatistic) => (s.sectionsTotal ? s.sectionsRead || 0 : 0);

  for (const s of statistics) {
    if (
      s.dateKey < period.startDateKey ||
      s.dateKey > period.endDateKey ||
      !passesTitle(s.title)
    ) {
      continue;
    }
    let row = byDay.get(s.dateKey);
    if (!row) {
      row = {
        dateKey: s.dateKey,
        seconds: 0,
        chars: 0,
        pages: 0,
        weightedSpeedCharsPerHour: 0,
        titles: [],
        completedBooks: 0
      };
      byDay.set(s.dateKey, row);
    }
    const t: DailyTitleContribution = {
      title: s.title,
      readingTime: s.readingTime || 0,
      charactersRead: s.charactersRead || 0,
      lastReadingSpeed: s.lastReadingSpeed || 0,
      completedBook: s.completedBook || 0,
      raw: s
    };
    const pages = pagesOf(s);
    row.titles.push(t);
    row.seconds += t.readingTime;
    row.completedBooks += t.completedBook;
    totalSeconds += t.readingTime;
    totalCompleted += t.completedBook;
    if (pages) {
      // For an image book `charactersRead` is one unit per page — the same
      // quantity, in the wrong column. Count it once, as pages.
      row.pages += pages;
      totalPages += pages;
    } else {
      row.chars += t.charactersRead;
      totalChars += t.charactersRead;
    }
  }

  // Weighted speed per day: char-weighted average of per-title lastReadingSpeed.
  // Zero when no chars (so speed doesn't misrepresent a manual-entry-only day).
  for (const row of byDay.values()) {
    if (row.chars > 0) {
      let num = 0;
      for (const t of row.titles) {
        if (pagesOf(t.raw)) continue;
        num += t.lastReadingSpeed * t.charactersRead;
      }
      row.weightedSpeedCharsPerHour = Math.round(num / row.chars);
    }
    row.titles.sort((a, b) => b.readingTime - a.readingTime);
  }

  const rows = [...byDay.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));

  return {
    rows,
    totalSeconds,
    totalChars,
    totalPages,
    totalCompleted,
    activeDays: rows.filter((r) => r.seconds > 0).length
  };
}
