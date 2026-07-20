/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { getDate } from '$lib/functions/statistic-util';

export interface ReadingHabitsSummary {
  /** 24-slot vector, hour → seconds across the filter range. */
  hourly: number[];
  /** 7×24 matrix, [dow][hour] → seconds. dow=0 is Sunday. */
  dowHour: number[][];
  /** 7-slot vector, dow → seconds. */
  dow: number[];
  /** Total seconds that carried an hourly breakdown. */
  totalWithBucket: number;
  /** Total reading seconds in range (with or without hourly). Used to
   * show a "% of time bucketed" hint if the value is far below the full total. */
  totalReadingTime: number;
  /** Peak hour index (0-23), or -1 if no data. */
  peakHour: number;
  /** Peak day-of-week (0-6, Sunday=0), or -1 if no data. */
  peakDow: number;
}

export interface ReadingHabitsFilter {
  startDate: string;
  endDate: string;
  startDayHoursForTracker: number;
  titleFilter?: Map<string, boolean>;
}

export function aggregateReadingHabits(
  statistics: BooksDbStatistic[],
  { startDate, endDate, startDayHoursForTracker, titleFilter }: ReadingHabitsFilter
): ReadingHabitsSummary {
  const hourly = new Array(24).fill(0) as number[];
  const dow = new Array(7).fill(0) as number[];
  const dowHour: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  let totalWithBucket = 0;
  let totalReadingTime = 0;

  for (const s of statistics) {
    if (startDate && s.dateKey < startDate) continue;
    if (endDate && s.dateKey > endDate) continue;
    if (titleFilter && titleFilter.size && !titleFilter.get(s.title)) continue;

    const time = s.readingTime || 0;
    totalReadingTime += time;

    const rowHourly = (s as { hourly?: number[] }).hourly;
    if (!rowHourly || rowHourly.length !== 24) continue;

    // startDayHours shift: the row's dateKey is the "logical" day; per-hour
    // buckets are still real wall-clock hours (0-23), so a session tracked at
    // 3am with startDayHours=4 shows up in dateKey=yesterday.hourly[3] — the
    // dow we assign should reflect the LOGICAL day, i.e. the row's dateKey.
    const rowDate = getDate(s.dateKey, startDayHoursForTracker);
    const dowIndex = rowDate.getDay();

    for (let h = 0; h < 24; h += 1) {
      const v = rowHourly[h] || 0;
      hourly[h] += v;
      dow[dowIndex] += v;
      dowHour[dowIndex][h] += v;
      totalWithBucket += v;
    }
  }

  let peakHour = -1;
  let peakHourValue = 0;
  for (let h = 0; h < 24; h += 1) {
    if (hourly[h] > peakHourValue) {
      peakHourValue = hourly[h];
      peakHour = h;
    }
  }

  let peakDow = -1;
  let peakDowValue = 0;
  for (let d = 0; d < 7; d += 1) {
    if (dow[d] > peakDowValue) {
      peakDowValue = dow[d];
      peakDow = d;
    }
  }

  return { hourly, dowHour, dow, totalWithBucket, totalReadingTime, peakHour, peakDow };
}
