/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { HighlightStatsSummary } from '$lib/functions/highlight-stats';
import type { MetadataStatsSummary } from '$lib/functions/metadata-stats';
import { toTimeString } from '$lib/functions/statistic-util';
import { highlightColorLabels, highlightColors } from '$lib/functions/highlight-stats';

export interface YearReportInput {
  startDate: string;
  endDate: string;
  label: string;
  statistics: BooksDbStatistic[];
  highlights: HighlightStatsSummary;
  metadata: MetadataStatsSummary;
}

interface DayTotals {
  readingTime: number;
  charactersRead: number;
}

export function buildYearReportMarkdown(input: YearReportInput): string {
  const { label, statistics, highlights, metadata } = input;

  const totals = { readingTime: 0, charactersRead: 0 };
  const perDay = new Map<string, DayTotals>();
  const titles = new Set<string>();
  for (const s of statistics) {
    totals.readingTime += s.readingTime || 0;
    totals.charactersRead += s.charactersRead || 0;
    const bucket = perDay.get(s.dateKey) || { readingTime: 0, charactersRead: 0 };
    bucket.readingTime += s.readingTime || 0;
    bucket.charactersRead += s.charactersRead || 0;
    perDay.set(s.dateKey, bucket);
    titles.add(s.title);
  }
  const daysRead = [...perDay.values()].filter((d) => d.readingTime > 0).length;
  const avgSpeed = totals.readingTime
    ? Math.round((3600 * totals.charactersRead) / totals.readingTime)
    : 0;

  const lines: string[] = [];
  lines.push(`# AutoBook 阅读报告 · ${label}`, '');

  lines.push('## 概览', '');
  lines.push(`- 阅读时长：**${toTimeString(totals.readingTime)}**`);
  lines.push(`- 已读字数：**${totals.charactersRead.toLocaleString()}**`);
  lines.push(`- 阅读天数：**${daysRead}**`);
  lines.push(`- 涉及书籍：**${titles.size}** 本`);
  if (avgSpeed) lines.push(`- 平均速度：**${avgSpeed.toLocaleString()} 字/时**`);
  lines.push('');

  if (metadata.completedBooks.length) {
    lines.push(`## 读完的书（${metadata.completedBooks.length}）`, '');
    for (const b of metadata.completedBooks) {
      const author = b.author ? ` · ${b.author}` : '';
      lines.push(`- \`${b.dateKey}\` **${b.title}**${author} — ${toTimeString(b.readingTime)}`);
    }
    lines.push('');
  }

  if (metadata.authors.length) {
    lines.push('## Top 作者', '');
    lines.push('| # | 作者 | 时长 | 字数 | 书 |');
    lines.push('|---|---|---|---|---|');
    metadata.authors.slice(0, 15).forEach((a, i) => {
      lines.push(
        `| ${i + 1} | ${a.author} | ${toTimeString(a.readingTime)} | ${Math.round(a.charactersRead).toLocaleString()} | ${a.titles.length} |`
      );
    });
    if (metadata.unattributedTime > 0) {
      lines.push(
        `\n> 另有 ${toTimeString(metadata.unattributedTime)} 无作者信息（未导入元数据或未手动标注）`
      );
    }
    lines.push('');
  }

  if (metadata.languages.length) {
    lines.push('## 语言分布', '');
    for (const l of metadata.languages) {
      lines.push(`- **${l.language}** — ${l.titles} 本 · ${toTimeString(l.readingTime)}`);
    }
    lines.push('');
  }

  if (metadata.subjects.length) {
    lines.push('## 分类标签', '');
    const chunk = metadata.subjects.slice(0, 40).map((s) => `\`${s.subject}\` ×${s.count}`);
    lines.push(chunk.join('  '));
    lines.push('');
  }

  if (metadata.hourlyTotal > 0) {
    lines.push('## 阅读时段', '');
    lines.push('| 时段 | 时长 |');
    lines.push('|---|---|');
    for (let h = 0; h < 24; h += 1) {
      const sec = metadata.hourly[h] || 0;
      if (sec > 0) {
        lines.push(`| ${`${h}`.padStart(2, '0')}:00 | ${toTimeString(sec)} |`);
      }
    }
    lines.push('');
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
      for (const color of highlightColors) {
        const c = highlights.colorBreakdown[color];
        const pct = highlights.totalHighlights
          ? Math.round((c / highlights.totalHighlights) * 100)
          : 0;
        lines.push(`- **${highlightColorLabels[color]}** — ${c} · ${pct}%`);
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
