/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Period resolution helper. Bridges the existing
 * `lastStatisticsStartDate$` / `lastStatisticsEndDate$` dateKey stores
 * (used by the old summary / heatmap views) to a shape convenient for
 * session filtering (start-of-day timestamps).
 */

const MS_PER_DAY = 86_400_000;

export interface PeriodBounds {
  /** Inclusive dateKey lower bound in YYYY-MM-DD format. */
  startDateKey: string;
  /** Inclusive dateKey upper bound in YYYY-MM-DD format. */
  endDateKey: string;
  /** Millisecond timestamp for session filtering (inclusive). */
  startTs: number;
  /** Millisecond timestamp for session filtering (exclusive). */
  endTs: number;
}

function isValidKey(k: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(k);
}

/**
 * Resolve a period from raw dateKey strings + the tracker's start-of-day
 * hour offset. Sessions with startTs in `[startTs, endTs)` fall in.
 *
 * If either dateKey is missing or malformed, returns null — caller should
 * skip aggregation until the panel finishes computing its default range.
 */
export function resolvePeriod(
  startDateKey: string,
  endDateKey: string,
  startDayHours: number
): PeriodBounds | null {
  if (!isValidKey(startDateKey) || !isValidKey(endDateKey)) return null;
  const [sy, sm, sd] = startDateKey.split('-').map(Number);
  const [ey, em, ed] = endDateKey.split('-').map(Number);
  const startTs = new Date(sy, sm - 1, sd, startDayHours, 0, 0, 0).getTime();
  // End dateKey is inclusive; convert to exclusive-of-next-day timestamp.
  const endTs =
    new Date(ey, em - 1, ed, startDayHours, 0, 0, 0).getTime() + MS_PER_DAY;
  return { startDateKey, endDateKey, startTs, endTs };
}
