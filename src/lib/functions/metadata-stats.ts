/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { BooksDbV10BookMetadata } from '$lib/data/database/books-db/versions/v10/books-db-v10';

export interface AuthorAggregate {
  author: string;
  readingTime: number;
  charactersRead: number;
  titles: string[];
}

export interface CompletedBookEntry {
  title: string;
  dateKey: string;
  author?: string;
  readingTime: number;
  charactersRead: number;
}

export interface LanguageAggregate {
  language: string;
  readingTime: number;
  charactersRead: number;
  titles: number;
}

export interface SubjectAggregate {
  subject: string;
  count: number;
}

export interface MetadataStatsSummary {
  authors: AuthorAggregate[];
  languages: LanguageAggregate[];
  subjects: SubjectAggregate[];
  completedBooks: CompletedBookEntry[];
  unattributedTime: number;
  hourly: number[];
  hourlyTotal: number;
}

export interface MetadataStatsFilter {
  startDate: string;
  endDate: string;
  titleFilter?: Map<string, boolean>;
}

export function aggregateMetadataStats(
  statistics: BooksDbStatistic[],
  metadataList: BooksDbV10BookMetadata[],
  { startDate, endDate, titleFilter }: MetadataStatsFilter
): MetadataStatsSummary {
  const metadataByTitle = new Map<string, BooksDbV10BookMetadata>();
  for (const m of metadataList) metadataByTitle.set(m.title, m);

  const authorMap = new Map<string, AuthorAggregate>();
  const languageMap = new Map<string, LanguageAggregate>();
  const subjectMap = new Map<string, SubjectAggregate>();
  const languageTitleSeen = new Map<string, Set<string>>();
  const completedBooks: CompletedBookEntry[] = [];
  const hourly = new Array(24).fill(0) as number[];
  let hourlyTotal = 0;
  let unattributedTime = 0;

  for (const s of statistics) {
    if (startDate && s.dateKey < startDate) continue;
    if (endDate && s.dateKey > endDate) continue;
    if (titleFilter && titleFilter.size && !titleFilter.get(s.title)) continue;

    const meta = metadataByTitle.get(s.title);
    const time = s.readingTime || 0;
    const chars = s.charactersRead || 0;

    if (time <= 0 && chars <= 0 && !s.completedBook) continue;

    if (meta?.author) {
      // Some EPUBs join multiple creators with commas; split so a two-author
      // book contributes to both — the extra split is a no-op for the common
      // single-author case.
      const authors = meta.author
        .split(/[,;/、；]/)
        .map((a) => a.trim())
        .filter(Boolean);
      const share = authors.length ? 1 / authors.length : 1;
      for (const author of authors) {
        const entry = authorMap.get(author) || {
          author,
          readingTime: 0,
          charactersRead: 0,
          titles: []
        };
        entry.readingTime += time * share;
        entry.charactersRead += chars * share;
        if (!entry.titles.includes(s.title)) entry.titles.push(s.title);
        authorMap.set(author, entry);
      }
    } else if (time > 0) {
      unattributedTime += time;
    }

    if (meta?.language) {
      const lang = meta.language;
      const seen = languageTitleSeen.get(lang) || new Set<string>();
      const isNewTitle = !seen.has(s.title);
      seen.add(s.title);
      languageTitleSeen.set(lang, seen);
      const entry = languageMap.get(lang) || {
        language: lang,
        readingTime: 0,
        charactersRead: 0,
        titles: 0
      };
      entry.readingTime += time;
      entry.charactersRead += chars;
      if (isNewTitle) entry.titles += 1;
      languageMap.set(lang, entry);
    }

    if (meta?.subjects?.length) {
      for (const subj of meta.subjects) {
        const trimmed = subj.trim();
        if (!trimmed) continue;
        const entry = subjectMap.get(trimmed) || { subject: trimmed, count: 0 };
        entry.count += 1;
        subjectMap.set(trimmed, entry);
      }
    }

    const rowHourly = (s as { hourly?: number[] }).hourly;
    if (rowHourly?.length === 24) {
      for (let h = 0; h < 24; h += 1) {
        const v = rowHourly[h] || 0;
        hourly[h] += v;
        hourlyTotal += v;
      }
    }

    if (s.completedBook) {
      const cd = s.completedData;
      completedBooks.push({
        title: s.title,
        dateKey: s.dateKey,
        author: meta?.author,
        readingTime: (cd?.readingTime as number | undefined) ?? time,
        charactersRead: (cd?.charactersRead as number | undefined) ?? chars
      });
    }
  }

  return {
    authors: [...authorMap.values()].sort((a, b) => b.readingTime - a.readingTime),
    languages: [...languageMap.values()].sort((a, b) => b.readingTime - a.readingTime),
    subjects: [...subjectMap.values()].sort((a, b) => b.count - a.count),
    completedBooks: completedBooks.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)),
    unattributedTime,
    hourly,
    hourlyTotal
  };
}
