/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Pure computation for the "年度" statistics tab. Fed raw daily statistics
 * rows (from the legacy per-day rollup) plus persisted sessions (v10 store);
 * returns display-ready shapes so the Svelte side is just render code.
 *
 * Sessions are only present for periods AFTER the v10 migration landed, so
 * hour-of-day / session-length outputs will be `null` (or empty arrays) for
 * years without any recorded sessions — the UI renders a "no session data
 * for this year" placeholder in that case.
 */

import type {
  BooksDbSession,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import { getDate, getDateKey } from '$lib/functions/statistic-util';

export interface YearSummaryInput {
  year: number;
  startDayHours: number;
  /** All daily statistic rows in the year (any book). */
  statistics: BooksDbStatistic[];
  /** All persisted sessions overlapping the year. */
  sessions: BooksDbSession[];
}

export interface MonthlyBar {
  month: number; // 1..12
  seconds: number;
  chars: number;
  /** Pages, for books measured in pages; never added to `chars`. */
  pages: number;
  activeDays: number;
}

export interface TopBook {
  title: string;
  seconds: number;
  chars: number;
  /** Pages for image books; `chars` stays 0 for those. */
  pages: number;
  days: number;
}

export interface StreakInfo {
  length: number;
  startDateKey: string;
  endDateKey: string;
}

export interface YearSummary {
  year: number;
  totalSeconds: number;
  totalChars: number;
  /** Pages read this year, kept apart from characters — a page is not a
   * character, and summing them made a comic inflate a novel's word count. */
  totalPages: number;
  /** Time and text delivered by each playback engine, when recorded. */
  ttsSeconds: number;
  ttsCharacters: number;
  typewriterSeconds: number;
  typewriterCharacters: number;
  activeDays: number;
  completedBooks: number;
  monthly: MonthlyBar[];
  topBooks: TopBook[];
  longestStreak: StreakInfo | null;
  bestDay: { dateKey: string; seconds: number; chars: number } | null;
  firstDay: { dateKey: string; titles: string[] } | null;
  lastDay: { dateKey: string; titles: string[] } | null;
  /** null when no sessions land in this year — earlier data doesn't have them. */
  sessionStats: SessionStats | null;
}

export interface SessionStats {
  count: number;
  totalSeconds: number;
  medianSeconds: number;
  p95Seconds: number;
  longestSeconds: number;
  /** Length 24; index i = seconds spent reading with the start-of-hour i (local). */
  hourHistogram: number[];
}

function yearBounds(year: number, startDayHours: number) {
  // "Year X" means "days whose dateKey (offset by startDayHours) is X-01-01..X-12-31".
  // We fabricate reference dates at noon to avoid DST edge cases.
  const jan1 = new Date(year, 0, 1, 12, 0, 0, 0);
  const dec31 = new Date(year, 11, 31, 12, 0, 0, 0);
  return {
    startDateKey: getDateKey(startDayHours, jan1),
    endDateKey: getDateKey(startDayHours, dec31)
  };
}

function monthOfDateKey(dateKey: string) {
  // dateKey format: "YYYY-MM-DD" (see getDateString in statistic-util)
  const parts = dateKey.split('-');
  return parts.length >= 2 ? Number(parts[1]) : 0;
}

function daysBetweenKeys(a: string, b: string): number {
  const parseKey = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  return Math.round((parseKey(b) - parseKey(a)) / 86_400_000);
}

function nextDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const yy = next.getFullYear();
  const mm = `${next.getMonth() + 1}`.padStart(2, '0');
  const dd = `${next.getDate()}`.padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

/**
 * Distribute a session's seconds across the 24 hour-of-day bins it overlaps.
 * A session that runs 22:30–00:15 contributes 30 min to hour 22, 60 min to
 * hour 23, and 15 min to hour 0. Sessions with `durationSec` that doesn't
 * match `endTs - startTs` (older records, clock adjustments, or ranged
 * pauses) get uniformly scaled to hit their reported `durationSec` — the
 * recorded duration wins as the source of truth.
 */
function binHourHistogram(session: BooksDbSession, out: number[]) {
  const spanMs = Math.max(0, session.endTs - session.startTs);
  if (!spanMs) {
    const hour = new Date(session.startTs).getHours();
    out[hour] += session.durationSec;
    return;
  }
  const scale = (session.durationSec * 1000) / spanMs;
  let cursor = session.startTs;
  while (cursor < session.endTs) {
    const d = new Date(cursor);
    const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    const nextHour = hourStart + 3_600_000;
    const chunkEnd = Math.min(session.endTs, nextHour);
    const chunkMs = chunkEnd - cursor;
    out[d.getHours()] += (chunkMs * scale) / 1000;
    cursor = chunkEnd;
  }
}

export function computeYearSummary(input: YearSummaryInput): YearSummary {
  const { year, startDayHours, statistics, sessions } = input;
  const { startDateKey, endDateKey } = yearBounds(year, startDayHours);

  const inYearStats = statistics.filter(
    (s) => s.dateKey >= startDateKey && s.dateKey <= endDateKey
  );

  // Per-day roll-up across all books, keyed by dateKey.
  const perDay = new Map<string, { seconds: number; chars: number; titles: Set<string> }>();
  const perTitle = new Map<string, TopBook>();
  const monthlyMap = new Map<number, MonthlyBar>();
  let totalSeconds = 0;
  let totalChars = 0;
  let totalPages = 0;
  let ttsSeconds = 0;
  let ttsCharacters = 0;
  let typewriterSeconds = 0;
  let typewriterCharacters = 0;
  let completedBooks = 0;

  /** Books measured in pages: the tracker recorded a page total for them. */
  const pagesOf = (row: BooksDbStatistic) => (row.sectionsTotal ? row.sectionsRead || 0 : 0);

  for (const row of inYearStats) {
    const rowPages = pagesOf(row);
    const rowChars = rowPages ? 0 : row.charactersRead || 0;

    totalSeconds += row.readingTime || 0;
    totalChars += rowChars;
    totalPages += rowPages;
    ttsSeconds += row.ttsSeconds || 0;
    ttsCharacters += row.ttsCharacters || 0;
    typewriterSeconds += row.typewriterSeconds || 0;
    typewriterCharacters += row.typewriterCharacters || 0;
    if (row.completedBook) completedBooks += row.completedBook;

    const dayBucket = perDay.get(row.dateKey) || {
      seconds: 0,
      chars: 0,
      titles: new Set<string>()
    };
    dayBucket.seconds += row.readingTime || 0;
    dayBucket.chars += rowChars;
    if (row.readingTime) dayBucket.titles.add(row.title);
    perDay.set(row.dateKey, dayBucket);

    const titleBucket = perTitle.get(row.title) || {
      title: row.title,
      seconds: 0,
      chars: 0,
      pages: 0,
      days: 0
    };
    titleBucket.seconds += row.readingTime || 0;
    titleBucket.chars += rowChars;
    titleBucket.pages += rowPages;
    if (row.readingTime) titleBucket.days += 1;
    perTitle.set(row.title, titleBucket);

    const month = monthOfDateKey(row.dateKey);
    if (month) {
      const bar = monthlyMap.get(month) || {
        month,
        seconds: 0,
        chars: 0,
        pages: 0,
        activeDays: 0
      };
      bar.seconds += row.readingTime || 0;
      bar.chars += rowChars;
      bar.pages += rowPages;
      monthlyMap.set(month, bar);
    }
  }

  // Fill monthly bars for months with no rows.
  const monthly: MonthlyBar[] = [];
  for (let m = 1; m <= 12; m += 1) {
    monthly.push(
      monthlyMap.get(m) || { month: m, seconds: 0, chars: 0, pages: 0, activeDays: 0 }
    );
  }

  // Compute active days per month + best day + streaks.
  const monthActive = new Map<number, Set<string>>();
  const activeDayKeys: string[] = [];
  let bestDay: YearSummary['bestDay'] = null;
  for (const [dateKey, bucket] of perDay) {
    if (!bucket.seconds) continue;
    activeDayKeys.push(dateKey);
    const month = monthOfDateKey(dateKey);
    if (!monthActive.has(month)) monthActive.set(month, new Set());
    monthActive.get(month)!.add(dateKey);
    if (!bestDay || bucket.seconds > bestDay.seconds) {
      bestDay = { dateKey, seconds: bucket.seconds, chars: bucket.chars };
    }
  }
  for (const bar of monthly) {
    bar.activeDays = monthActive.get(bar.month)?.size ?? 0;
  }
  activeDayKeys.sort();

  // Longest streak.
  let longestStreak: StreakInfo | null = null;
  if (activeDayKeys.length) {
    let runStart = activeDayKeys[0];
    let runLen = 1;
    let runEnd = activeDayKeys[0];
    let best: StreakInfo = { length: 1, startDateKey: runStart, endDateKey: runEnd };
    for (let i = 1; i < activeDayKeys.length; i += 1) {
      const prev = activeDayKeys[i - 1];
      const curr = activeDayKeys[i];
      if (daysBetweenKeys(prev, curr) === 1 || nextDayKey(prev) === curr) {
        runLen += 1;
        runEnd = curr;
      } else {
        if (runLen > best.length) {
          best = { length: runLen, startDateKey: runStart, endDateKey: runEnd };
        }
        runStart = curr;
        runEnd = curr;
        runLen = 1;
      }
    }
    if (runLen > best.length) {
      best = { length: runLen, startDateKey: runStart, endDateKey: runEnd };
    }
    longestStreak = best;
  }

  // First / last active day: keep list of titles read that day (may be > 1).
  const firstDay = activeDayKeys.length
    ? { dateKey: activeDayKeys[0], titles: [...(perDay.get(activeDayKeys[0])?.titles ?? [])] }
    : null;
  const lastDay = activeDayKeys.length
    ? {
        dateKey: activeDayKeys[activeDayKeys.length - 1],
        titles: [...(perDay.get(activeDayKeys[activeDayKeys.length - 1])?.titles ?? [])]
      }
    : null;

  const topBooks = [...perTitle.values()]
    .filter((b) => b.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  // Session-derived stats — only for sessions falling inside the year, and
  // only if there are any at all (feature is new; older years won't have any).
  const jan1 = getDate(startDateKey, startDayHours).getTime();
  const dec31 = getDate(endDateKey, startDayHours).getTime() + 86_400_000;
  const inYearSessions = sessions.filter(
    (s) => s.startTs >= jan1 && s.startTs < dec31
  );

  let sessionStats: SessionStats | null = null;
  if (inYearSessions.length) {
    const durations = inYearSessions.map((s) => s.durationSec).sort((a, b) => a - b);
    const hourHistogram = new Array<number>(24).fill(0);
    let sessionTotal = 0;
    for (const s of inYearSessions) {
      sessionTotal += s.durationSec;
      binHourHistogram(s, hourHistogram);
    }
    sessionStats = {
      count: inYearSessions.length,
      totalSeconds: sessionTotal,
      medianSeconds: median(durations),
      p95Seconds: percentile(durations, 0.95),
      longestSeconds: durations[durations.length - 1] || 0,
      hourHistogram
    };
  }

  return {
    year,
    totalSeconds,
    totalChars,
    totalPages,
    ttsSeconds,
    ttsCharacters,
    typewriterSeconds,
    typewriterCharacters,
    activeDays: activeDayKeys.length,
    completedBooks,
    monthly,
    topBooks,
    longestStreak,
    bestDay,
    firstDay,
    lastDay,
    sessionStats
  };
}
