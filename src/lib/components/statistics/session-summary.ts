/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Period-scoped aggregation over persisted sessions + legacy daily
 * statistics. Powers the main statistics tab and (soon) the books /
 * authors / sessions explorer tabs.
 *
 * Session store is v10 (1.17.0) and doesn't cover earlier data — so
 * DOW × hour and per-session quantiles are null for periods that
 * predate the migration. Aggregate hero metrics (total time / chars /
 * days / books) always come through since the daily rollup is
 * populated retroactively via the tracker's day-summary path.
 */

import type {
  BooksDbSession,
  BooksDbStatistic
} from '$lib/data/database/books-db/versions/books-db';
import type { PeriodBounds } from './statistics-period';

export interface PeriodInput {
  period: PeriodBounds;
  /** Daily rollup rows overlapping the period (any book). */
  statistics: BooksDbStatistic[];
  /** All persisted sessions overlapping the period. */
  sessions: BooksDbSession[];
  /** Optional title filter — only titles whose Map value is true count. */
  titleFilter?: Map<string, boolean>;
}

export interface MonthlyBar {
  /** YYYY-MM key so different-year windows don't collide. */
  key: string;
  label: string;
  seconds: number;
  chars: number;
  activeDays: number;
}

export interface TopBook {
  title: string;
  seconds: number;
  chars: number;
  days: number;
}

export interface StreakInfo {
  length: number;
  startDateKey: string;
  endDateKey: string;
}

export interface SessionStats {
  count: number;
  totalSeconds: number;
  medianSeconds: number;
  p95Seconds: number;
  longestSeconds: number;
  /** Length 24; index i = seconds spent reading with the start-of-hour i (local). */
  hourHistogram: number[];
  /** 7 × 24 matrix: [dayOfWeek 0=Sun..6=Sat][hour 0..23] = seconds.
   * Values are seconds; the render side normalizes to a color scale.
   * Null when there are no sessions in the period. */
  dowHourMatrix: number[][];
}

export interface PeriodSummary {
  totalSeconds: number;
  totalChars: number;
  activeDays: number;
  completedBooks: number;
  /** One entry per month spanned by the period. If the period spans
   * exactly one calendar year we get 12 entries; a rolling week we
   * get 1–2 (whichever months the week overlaps). */
  monthly: MonthlyBar[];
  topBooks: TopBook[];
  longestStreak: StreakInfo | null;
  bestDay: { dateKey: string; seconds: number; chars: number } | null;
  firstDay: { dateKey: string; titles: string[] } | null;
  lastDay: { dateKey: string; titles: string[] } | null;
  /** null when there are no sessions in the period — earlier data
   * (pre-v10) doesn't have any. UI shows a "session data starts on
   * {earliestSessionDate}" hint. */
  sessionStats: SessionStats | null;
}

function monthOfDateKey(dateKey: string): string {
  return dateKey.length >= 7 ? dateKey.slice(0, 7) : '';
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
 * Distribute a session's seconds across the 24 hour bins it overlaps
 * and the DOW × hour matrix. A session that runs 22:30–00:15 on a
 * Wednesday contributes to Wed 22:00, Wed 23:00, and Thu 00:00.
 * Duration truth is `session.durationSec` (recorded); we scale span
 * time to match it if the wall clock and recorded duration disagree
 * (paused sessions, DST shifts, older records).
 */
function binHourAndDow(
  session: BooksDbSession,
  hourOut: number[],
  dowOut: number[][]
) {
  const spanMs = Math.max(0, session.endTs - session.startTs);
  if (!spanMs) {
    const d = new Date(session.startTs);
    hourOut[d.getHours()] += session.durationSec;
    dowOut[d.getDay()][d.getHours()] += session.durationSec;
    return;
  }
  const scale = (session.durationSec * 1000) / spanMs;
  let cursor = session.startTs;
  while (cursor < session.endTs) {
    const d = new Date(cursor);
    const hourStart = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours()
    ).getTime();
    const nextHour = hourStart + 3_600_000;
    const chunkEnd = Math.min(session.endTs, nextHour);
    const chunkMs = chunkEnd - cursor;
    const secs = (chunkMs * scale) / 1000;
    hourOut[d.getHours()] += secs;
    dowOut[d.getDay()][d.getHours()] += secs;
    cursor = chunkEnd;
  }
}

function monthLabel(key: string): string {
  const [_y, m] = key.split('-').map(Number);
  return `${m}月`;
}

function* iterMonths(startKey: string, endKey: string): Generator<string> {
  const [sy, sm] = startKey.split('-').map(Number);
  const [ey, em] = endKey.split('-').map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${`${m}`.padStart(2, '0')}`;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

export function computePeriodSummary(input: PeriodInput): PeriodSummary {
  const { period, statistics, sessions, titleFilter } = input;
  const { startDateKey, endDateKey, startTs, endTs } = period;
  const passesTitle = (t: string) =>
    !titleFilter || titleFilter.size === 0 || titleFilter.get(t) === true;

  const inRangeStats = statistics.filter(
    (s) => s.dateKey >= startDateKey && s.dateKey <= endDateKey && passesTitle(s.title)
  );

  const perDay = new Map<string, { seconds: number; chars: number; titles: Set<string> }>();
  const perTitle = new Map<string, TopBook>();
  const monthlyMap = new Map<string, MonthlyBar>();
  let totalSeconds = 0;
  let totalChars = 0;
  let completedBooks = 0;

  for (const row of inRangeStats) {
    totalSeconds += row.readingTime || 0;
    totalChars += row.charactersRead || 0;
    if (row.completedBook) completedBooks += row.completedBook;

    const dayBucket = perDay.get(row.dateKey) || {
      seconds: 0,
      chars: 0,
      titles: new Set<string>()
    };
    dayBucket.seconds += row.readingTime || 0;
    dayBucket.chars += row.charactersRead || 0;
    if (row.readingTime) dayBucket.titles.add(row.title);
    perDay.set(row.dateKey, dayBucket);

    const titleBucket = perTitle.get(row.title) || {
      title: row.title,
      seconds: 0,
      chars: 0,
      days: 0
    };
    titleBucket.seconds += row.readingTime || 0;
    titleBucket.chars += row.charactersRead || 0;
    if (row.readingTime) titleBucket.days += 1;
    perTitle.set(row.title, titleBucket);

    const monthKey = monthOfDateKey(row.dateKey);
    if (monthKey) {
      const bar = monthlyMap.get(monthKey) || {
        key: monthKey,
        label: monthLabel(monthKey),
        seconds: 0,
        chars: 0,
        activeDays: 0
      };
      bar.seconds += row.readingTime || 0;
      bar.chars += row.charactersRead || 0;
      monthlyMap.set(monthKey, bar);
    }
  }

  const monthly: MonthlyBar[] = [];
  for (const k of iterMonths(startDateKey, endDateKey)) {
    monthly.push(
      monthlyMap.get(k) || {
        key: k,
        label: monthLabel(k),
        seconds: 0,
        chars: 0,
        activeDays: 0
      }
    );
  }
  // Cap ridiculously wide "全部" ranges — beyond 36 bars readability
  // dies. If we spill, aggregate quarters instead. Rare enough not to
  // do now; leave as TODO for the ALL preset if users complain.

  const monthActive = new Map<string, Set<string>>();
  const activeDayKeys: string[] = [];
  let bestDay: PeriodSummary['bestDay'] = null;
  for (const [dateKey, bucket] of perDay) {
    if (!bucket.seconds) continue;
    activeDayKeys.push(dateKey);
    const monthKey = monthOfDateKey(dateKey);
    if (!monthActive.has(monthKey)) monthActive.set(monthKey, new Set());
    monthActive.get(monthKey)!.add(dateKey);
    if (!bestDay || bucket.seconds > bestDay.seconds) {
      bestDay = { dateKey, seconds: bucket.seconds, chars: bucket.chars };
    }
  }
  for (const bar of monthly) {
    bar.activeDays = monthActive.get(bar.key)?.size ?? 0;
  }
  activeDayKeys.sort();

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
    .slice(0, 10);

  const inRangeSessions = sessions.filter(
    (s) => s.startTs >= startTs && s.startTs < endTs && passesTitle(s.title)
  );
  let sessionStats: SessionStats | null = null;
  if (inRangeSessions.length) {
    const durations = inRangeSessions.map((s) => s.durationSec).sort((a, b) => a - b);
    const hourHistogram = new Array<number>(24).fill(0);
    const dowHourMatrix: number[][] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      dowHourMatrix.push(new Array<number>(24).fill(0));
    }
    let sessionTotal = 0;
    for (const s of inRangeSessions) {
      sessionTotal += s.durationSec;
      binHourAndDow(s, hourHistogram, dowHourMatrix);
    }
    sessionStats = {
      count: inRangeSessions.length,
      totalSeconds: sessionTotal,
      medianSeconds: median(durations),
      p95Seconds: percentile(durations, 0.95),
      longestSeconds: durations[durations.length - 1] || 0,
      hourHistogram,
      dowHourMatrix
    };
  }

  return {
    totalSeconds,
    totalChars,
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
