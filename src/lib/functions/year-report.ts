/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { AuthorRow } from '$lib/components/statistics/books-summary';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { HighlightStatsSummary } from '$lib/functions/highlight-stats';
import type { YearSummary } from '$lib/components/statistics/statistics-year/year-summary';
import { toTimeString } from '$lib/functions/statistic-util';
import { highlightSlotLabel, highlightSlots } from '$lib/functions/highlight-stats';
import { UNKNOWN_AUTHOR_KEY } from '$lib/components/statistics/books-summary';

export interface YearReportInput {
  label: string;
  startDate: string;
  endDate: string;
  /** Statistics rows already scoped to the report's date range. */
  statistics: BooksDbStatistic[];
  highlights: HighlightStatsSummary;
  /** Per-author rollup for the same range. Empty when no book in the range
   * has an author from either manualBook or the imported file's metadata. */
  authors?: AuthorRow[];
  /** Full-year summary. Optional — when the range doesn't align to a calendar
   * year (e.g. "本月") we still include it for context. */
  year?: YearSummary;
}

const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

interface DayTotals {
  readingTime: number;
  charactersRead: number;
}

export function buildYearReportMarkdown(input: YearReportInput): string {
  const { label, statistics, highlights, authors, year } = input;

  const totals = { readingTime: 0, charactersRead: 0 };
  const perDay = new Map<string, DayTotals>();
  const titles = new Set<string>();
  const perTitle = new Map<string, { seconds: number; chars: number }>();
  let completedInRange = 0;
  for (const s of statistics) {
    totals.readingTime += s.readingTime || 0;
    totals.charactersRead += s.charactersRead || 0;
    const bucket = perDay.get(s.dateKey) || { readingTime: 0, charactersRead: 0 };
    bucket.readingTime += s.readingTime || 0;
    bucket.charactersRead += s.charactersRead || 0;
    perDay.set(s.dateKey, bucket);
    titles.add(s.title);
    const t = perTitle.get(s.title) || { seconds: 0, chars: 0 };
    t.seconds += s.readingTime || 0;
    t.chars += s.charactersRead || 0;
    perTitle.set(s.title, t);
    if (s.completedBook) completedInRange += s.completedBook;
  }
  const daysRead = [...perDay.values()].filter((d) => d.readingTime > 0).length;
  const avgSpeed = totals.readingTime
    ? Math.round((3600 * totals.charactersRead) / totals.readingTime)
    : 0;

  const lines: string[] = [];
  lines.push(`# AutoBook 阅读报告 · ${label}`, '');

  lines.push('## 时间段概览', '');
  lines.push(`- 阅读时长：**${toTimeString(totals.readingTime)}**`);
  lines.push(`- 已读字数：**${totals.charactersRead.toLocaleString()}**`);
  lines.push(`- 阅读天数：**${daysRead}**`);
  lines.push(`- 涉及书籍：**${titles.size}** 本`);
  if (completedInRange) lines.push(`- 读完：**${completedInRange}** 本`);
  if (avgSpeed) lines.push(`- 平均速度：**${avgSpeed.toLocaleString()} 字/时**`);
  lines.push('');

  const topInRange = [...perTitle.entries()]
    .filter(([, v]) => v.seconds > 0)
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .slice(0, 10);
  if (topInRange.length) {
    lines.push('## 本期 Top 书籍', '');
    lines.push('| # | 书名 | 时长 | 字数 |');
    lines.push('|---|---|---|---|');
    topInRange.forEach(([title, v], i) => {
      lines.push(`| ${i + 1} | ${title} | ${toTimeString(v.seconds)} | ${v.chars.toLocaleString()} |`);
    });
    lines.push('');
  }

  const rankedAuthors = (authors ?? [])
    .filter((a) => a.author !== UNKNOWN_AUTHOR_KEY && a.seconds > 0)
    .slice(0, 10);
  if (rankedAuthors.length) {
    lines.push('## 本期 Top 作者', '');
    lines.push('| # | 作者 | 时长 | 字数 | 书目 |');
    lines.push('|---|---|---|---|---|');
    rankedAuthors.forEach((a, i) => {
      lines.push(
        `| ${i + 1} | ${a.author} | ${toTimeString(a.seconds)} | ${a.chars.toLocaleString()} | ${a.books.join('、')} |`
      );
    });
    lines.push('');
  }

  if (year) {
    lines.push(`## ${year.year} 年度全景`, '');
    lines.push(`- 全年时长：**${toTimeString(year.totalSeconds)}**`);
    lines.push(`- 全年字数：**${year.totalChars.toLocaleString()}**`);
    lines.push(`- 活跃天数：**${year.activeDays}**`);
    lines.push(`- 读完：**${year.completedBooks}** 本`);
    if (year.longestStreak) {
      lines.push(
        `- 最长连续：**${year.longestStreak.length}** 天（${year.longestStreak.startDateKey} → ${year.longestStreak.endDateKey}）`
      );
    }
    if (year.bestDay) {
      lines.push(
        `- 最强的一天：${year.bestDay.dateKey} · ${toTimeString(year.bestDay.seconds)} · ${year.bestDay.chars.toLocaleString()} 字`
      );
    }
    if (year.firstDay) lines.push(`- 起点：${year.firstDay.dateKey} · ${year.firstDay.titles.join('、')}`);
    if (year.lastDay && year.lastDay.dateKey !== year.firstDay?.dateKey) {
      lines.push(`- 最新：${year.lastDay.dateKey} · ${year.lastDay.titles.join('、')}`);
    }
    lines.push('');

    if (year.monthly.some((m) => m.seconds > 0)) {
      lines.push('### 月度分布', '');
      lines.push('| 月 | 时长 | 字数 | 活跃天 |');
      lines.push('|---|---|---|---|');
      year.monthly.forEach((m) => {
        if (!m.seconds && !m.chars && !m.activeDays) return;
        lines.push(
          `| ${monthLabels[m.month - 1]} | ${toTimeString(m.seconds)} | ${m.chars.toLocaleString()} | ${m.activeDays} |`
        );
      });
      lines.push('');
    }

    if (year.topBooks.length) {
      lines.push('### 全年 Top 书籍', '');
      year.topBooks.forEach((b, i) => {
        lines.push(
          `${i + 1}. **${b.title}** — ${toTimeString(b.seconds)} · ${b.chars.toLocaleString()} 字 · ${b.days} 天`
        );
      });
      lines.push('');
    }

    if (year.sessionStats) {
      const ss = year.sessionStats;
      lines.push('### 阅读会话', '');
      lines.push(`- 会话数：**${ss.count}**`);
      lines.push(`- 中位时长：**${toTimeString(ss.medianSeconds)}**`);
      lines.push(`- P95 时长：**${toTimeString(ss.p95Seconds)}**`);
      lines.push(`- 单次最长：**${toTimeString(ss.longestSeconds)}**`);
      lines.push('');

      if (ss.hourHistogram.some((v) => v > 0)) {
        lines.push('#### 阅读时段（24 小时）', '');
        lines.push('| 时段 | 时长 |');
        lines.push('|---|---|');
        for (let h = 0; h < 24; h += 1) {
          const sec = ss.hourHistogram[h] || 0;
          if (sec > 0) {
            lines.push(`| ${`${h}`.padStart(2, '0')}:00 | ${toTimeString(Math.round(sec))} |`);
          }
        }
        lines.push('');
      }
    }
  }

  const highlightsTotal = highlights.totalHighlights + highlights.totalNotes;
  if (highlightsTotal > 0) {
    lines.push('## 高亮与笔记', '');
    lines.push(`- 高亮：**${highlights.totalHighlights}** 条`);
    lines.push(`- 笔记：**${highlights.totalNotes}** 条`);
    lines.push(`- 摘录字数：**${highlights.totalCharacters.toLocaleString()}**`);
    lines.push(`- 有高亮的天数：**${highlights.daysWithHighlights}**`);
    lines.push('');

    if (highlights.totalHighlights > 0) {
      lines.push('### 颜色分布', '');
      for (const color of highlightSlots) {
        const c = highlights.colorBreakdown[color];
        const pct = highlights.totalHighlights
          ? Math.round((c / highlights.totalHighlights) * 100)
          : 0;
        lines.push(`- **${highlightSlotLabel(color)}** — ${c} · ${pct}%`);
      }
      lines.push('');
    }

    if (highlights.byBook.length) {
      lines.push('### Top 划线最多的书', '');
      for (const [i, b] of highlights.byBook.slice(0, 10).entries()) {
        const notes = b.notes ? ` · ${b.notes} 笔记` : '';
        lines.push(`${i + 1}. **${b.title}** — ${b.highlights} 高亮${notes}`);
      }
      lines.push('');
    }

    if (highlights.byTag.length) {
      lines.push('### Top 标签', '');
      lines.push(highlights.byTag.slice(0, 30).map((t) => `\`#${t.tag}\` ×${t.count}`).join('  '));
      lines.push('');
    }
  }

  lines.push('---', '', `_由 AutoBook 生成 · ${new Date().toISOString().slice(0, 10)}_`);
  return lines.join('\n');
}
