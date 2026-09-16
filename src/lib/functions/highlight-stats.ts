/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';
import type { HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
import { getDate, getDateString } from '$lib/functions/statistic-util';
import { HIGHLIGHT_SLOTS } from '$lib/data/highlight-color';

export { HIGHLIGHT_SLOTS as highlightSlots };

/** Slots have no fixed colour any more, so the label is just the position. */
export const highlightSlotLabel = (slot: HighlightSlot) => `高亮 ${slot}`;

export interface HighlightBookCount {
  title: string;
  highlights: number;
  notes: number;
  characters: number;
}

export interface HighlightTagCount {
  tag: string;
  count: number;
}

export interface HighlightStatsSummary {
  totalHighlights: number;
  totalNotes: number;
  totalCharacters: number;
  daysWithHighlights: number;
  colorBreakdown: Record<HighlightSlot, number>;
  byBook: HighlightBookCount[];
  byTag: HighlightTagCount[];
  byMonth: { monthKey: string; count: number }[];
}

function isNote(h: BooksDbHighlight) {
  return h.kind === 'note' || (!h.text && !!h.memo);
}

export interface HighlightStatsFilter {
  startDate: string;
  endDate: string;
  startDayHoursForTracker: number;
  titleFilter?: Map<string, boolean>;
}

export function aggregateHighlightStats(
  highlights: BooksDbHighlight[],
  { startDate, endDate, startDayHoursForTracker, titleFilter }: HighlightStatsFilter
): HighlightStatsSummary {
  const rangeStart = startDate
    ? getDate(startDate, startDayHoursForTracker).getTime()
    : Number.NEGATIVE_INFINITY;
  const rangeEndDate = endDate
    ? getDate(endDate, startDayHoursForTracker)
    : new Date(Number.POSITIVE_INFINITY);
  if (endDate) {
    rangeEndDate.setDate(rangeEndDate.getDate() + 1);
  }
  const rangeEnd = rangeEndDate.getTime();

  const colorBreakdown: Record<HighlightSlot, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
  const byBookMap = new Map<string, HighlightBookCount>();
  const byTagMap = new Map<string, number>();
  const dayKeys = new Set<string>();
  const monthMap = new Map<string, number>();

  let totalHighlights = 0;
  let totalNotes = 0;
  let totalCharacters = 0;

  for (let i = 0; i < highlights.length; i += 1) {
    const h = highlights[i];
    const created = h.createdAt || h.lastModified || 0;
    if (created < rangeStart || created >= rangeEnd) continue;

    const bookTitle = h.bookTitle || '（未命名笔记）';
    if (titleFilter && titleFilter.size && !titleFilter.get(bookTitle)) continue;

    const noteFlag = isNote(h);
    const chars = h.text ? h.text.length : 0;

    if (noteFlag) {
      totalNotes += 1;
    } else {
      totalHighlights += 1;
      totalCharacters += chars;
      if (colorBreakdown[h.color] !== undefined) {
        colorBreakdown[h.color] += 1;
      }
    }

    const bookEntry = byBookMap.get(bookTitle) || {
      title: bookTitle,
      highlights: 0,
      notes: 0,
      characters: 0
    };
    if (noteFlag) bookEntry.notes += 1;
    else {
      bookEntry.highlights += 1;
      bookEntry.characters += chars;
    }
    byBookMap.set(bookTitle, bookEntry);

    if (h.tags?.length) {
      for (const tag of h.tags) {
        const trimmed = tag.trim();
        if (!trimmed) continue;
        byTagMap.set(trimmed, (byTagMap.get(trimmed) || 0) + 1);
      }
    }

    const dayKey = getDateString(new Date(created));
    dayKeys.add(dayKey);
    const monthKey = dayKey.slice(0, 7);
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
  }

  const byBook = [...byBookMap.values()].sort(
    (a, b) => b.highlights + b.notes - (a.highlights + a.notes)
  );
  const byTag = [...byTagMap.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
  const byMonth = [...monthMap.entries()]
    .map(([monthKey, count]) => ({ monthKey, count }))
    .sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));

  return {
    totalHighlights,
    totalNotes,
    totalCharacters,
    daysWithHighlights: dayKeys.size,
    colorBreakdown,
    byBook,
    byTag,
    byMonth
  };
}
