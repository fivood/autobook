<script lang="ts">
  /**
   * Redesigned main statistics tab (1.19.0). Session-based hero + DOW×hour
   * heatmap + monthly bars + top books. Replaces the old calendar heatmap
   * as the default landing view; the calendar heatmap tab still exists
   * but will be removed once this ships.
   */
  import type {
    BooksDbSession,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import {
    computePeriodSummary,
    type PeriodSummary
  } from '$lib/components/statistics/session-summary';
  import { resolvePeriod } from '$lib/components/statistics/statistics-period';
  import { secondsToMinutes } from '$lib/functions/statistic-util';
  import { t, tImmediate } from '$lib/i18n';

  export let statistics: BooksDbStatistic[] = [];
  export let sessions: BooksDbSession[] = [];
  export let startDate: string;
  export let endDate: string;
  export let startDayHours: number;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  $: bounds = resolvePeriod(startDate, endDate, startDayHours);
  $: summary =
    bounds !== null
      ? computePeriodSummary({
          period: bounds,
          statistics: statistics as unknown as BooksDbStatistic[],
          sessions,
          titleFilter
        })
      : (null as PeriodSummary | null);

  $: monthlyMax = summary ? Math.max(1, ...summary.monthly.map((m) => m.seconds)) : 1;
  // DOW×hour matrix color scale — use per-cell seconds, normalize to the
  // matrix max so a quiet week doesn't wash out.
  $: heatmapMax = summary?.sessionStats
    ? Math.max(1, ...summary.sessionStats.dowHourMatrix.flat())
    : 1;

  $: DOW_LABELS = [
    $t('stats.dow.sun'),
    $t('stats.dow.mon'),
    $t('stats.dow.tue'),
    $t('stats.dow.wed'),
    $t('stats.dow.thu'),
    $t('stats.dow.fri'),
    $t('stats.dow.sat')
  ];

  function formatHours(seconds: number): string {
    const h = seconds / 3600;
    if (h >= 10) return `${h.toFixed(0)}h`;
    if (h >= 1) return `${h.toFixed(1)}h`;
    const min = Math.round(seconds / 60);
    return `${min}m`;
  }

  function formatDuration(seconds: number): string {
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      return m ? `${h}h${m}m` : `${h}h`;
    }
    return `${Math.max(1, Math.round(seconds / 60))}m`;
  }

  function cellStyle(seconds: number, max: number): string {
    if (seconds <= 0) return 'background:transparent';
    const t = Math.min(1, seconds / max);
    // Ramp opacity 0.15 → 1.0 for visibility floor.
    const alpha = 0.15 + t * 0.85;
    return `background:var(--accent-color, #4a90e2);opacity:${alpha.toFixed(2)}`;
  }
</script>

{#if summary}
  <div class="my-4 opacity-80">
    {$t('stats.main.header', { range: statisticsDateRangeLabel })}
  </div>

  <!-- Hero 4 cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
    <div class="rounded border border-gray-500/30 p-4">
      <div class="text-xs opacity-70">{$t('stats.main.totalTime')}</div>
      <div class="text-2xl font-medium tabular-nums">
        {formatHours(summary.totalSeconds)}
      </div>
      <div class="text-[11px] opacity-50 mt-1">
        {secondsToMinutes(summary.totalSeconds)} {$t('stats.summary.minutesPh')}
      </div>
    </div>
    <div class="rounded border border-gray-500/30 p-4">
      <div class="text-xs opacity-70">{$t('stats.main.readDays')}</div>
      <div class="text-2xl font-medium tabular-nums">{summary.activeDays}</div>
      {#if summary.longestStreak}
        <div class="text-[11px] opacity-50 mt-1">
          {$t('stats.main.longestStreakLabel', { n: summary.longestStreak.length })}
        </div>
      {/if}
    </div>
    <div class="rounded border border-gray-500/30 p-4">
      <div class="text-xs opacity-70">{$t('stats.main.totalChars')}</div>
      <div class="text-2xl font-medium tabular-nums">
        {summary.totalChars.toLocaleString()}
      </div>
    </div>
    <div class="rounded border border-gray-500/30 p-4">
      <div class="text-xs opacity-70">{$t('stats.main.completedBooks')}</div>
      <div class="text-2xl font-medium tabular-nums">{summary.completedBooks}</div>
      {#if summary.topBooks.length}
        <div class="text-[11px] opacity-50 mt-1">
          {$t('stats.main.hasBooks', { n: summary.topBooks.length })}
        </div>
      {/if}
    </div>
  </div>

  <!-- DOW × hour heatmap -->
  <section class="my-6">
    <h3 class="text-lg mb-2">{$t('stats.main.dowHour')}</h3>
    {#if summary.sessionStats}
      <div class="overflow-x-auto">
        <div class="grid" style="grid-template-columns: 1.5rem repeat(24, minmax(0.9rem, 1fr));">
          <!-- Column headers: hour of day (show 0/6/12/18) -->
          <div></div>
          {#each Array(24) as _, h}
            <div class="text-[10px] opacity-50 text-center">
              {h % 6 === 0 ? h : ''}
            </div>
          {/each}
          <!-- 7 rows: day of week -->
          {#each DOW_LABELS as label, dow (label)}
            <div class="text-[11px] opacity-60 text-right pr-1 leading-4">{label}</div>
            {#each summary.sessionStats.dowHourMatrix[dow] as sec, hour (dow + '-' + hour)}
              <div
                class="h-4 rounded-sm border border-gray-500/10"
                style={cellStyle(sec, heatmapMax)}
                title={tImmediate('stats.main.dowHourTooltip', { dow: label, hour, duration: formatDuration(sec) })}
              ></div>
            {/each}
          {/each}
        </div>
      </div>
      <div class="text-[11px] opacity-60 mt-2">
        {$t('stats.main.sessionSummary', {
          count: summary.sessionStats.count,
          median: formatDuration(summary.sessionStats.medianSeconds),
          p95: formatDuration(summary.sessionStats.p95Seconds),
          longest: formatDuration(summary.sessionStats.longestSeconds)
        })}
      </div>
    {:else}
      <div class="opacity-60 text-sm py-4">
        {$t('stats.main.dowHourEmpty')}
      </div>
    {/if}
  </section>

  <!-- Monthly bars (only show when spanning > 1 month) -->
  {#if summary.monthly.length > 1}
    <section class="my-6">
      <h3 class="text-lg mb-2">{$t('stats.main.monthly')}</h3>
      <div class="flex items-end gap-1 h-24">
        {#each summary.monthly as m (m.key)}
          <div class="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div
              class="w-full rounded-t"
              style="height:{(m.seconds / monthlyMax) * 100}%;min-height:2px;background:var(--accent-color, #4a90e2);opacity:.55"
              title={tImmediate('stats.main.monthlyTooltip', { key: m.key, duration: formatDuration(m.seconds), days: m.activeDays })}
            ></div>
            <div class="text-[10px] opacity-60 truncate w-full text-center">
              {m.label}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Top books -->
  {#if summary.topBooks.length}
    <section class="my-6">
      <h3 class="text-lg mb-2">{$t('stats.main.topBooks')}</h3>
      <div class="flex flex-col gap-1">
        {#each summary.topBooks as book, i (book.title)}
          <div
            class="grid grid-cols-[2rem_1fr_auto] gap-3 items-center text-sm py-1 border-b border-gray-500/20"
          >
            <div class="opacity-60 tabular-nums">#{i + 1}</div>
            <div class="truncate" title={book.title}>{book.title}</div>
            <div class="opacity-80 tabular-nums text-right">
              {$t('stats.main.topBookMeta', { duration: formatDuration(book.seconds), days: book.days })}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if summary.bestDay || summary.firstDay}
    <section class="my-6 grid grid-cols-1 md:grid-cols-3 gap-3">
      {#if summary.longestStreak}
        <div class="rounded border border-gray-500/30 p-4">
          <div class="text-xs opacity-70">{$t('stats.main.longestStreak')}</div>
          <div class="text-xl font-medium tabular-nums">
            {$t('stats.main.longestStreakLabel', { n: summary.longestStreak.length })}
          </div>
          <div class="text-[11px] opacity-50 mt-1">
            {summary.longestStreak.startDateKey} → {summary.longestStreak.endDateKey}
          </div>
        </div>
      {/if}
      {#if summary.bestDay}
        <div class="rounded border border-gray-500/30 p-4">
          <div class="text-xs opacity-70">{$t('stats.main.bestDay')}</div>
          <div class="text-xl font-medium tabular-nums">
            {formatDuration(summary.bestDay.seconds)}
          </div>
          <div class="text-[11px] opacity-50 mt-1">{summary.bestDay.dateKey}</div>
        </div>
      {/if}
      {#if summary.firstDay}
        <div class="rounded border border-gray-500/30 p-4">
          <div class="text-xs opacity-70">{$t('stats.main.firstDay')}</div>
          <div class="text-xl font-medium">{summary.firstDay.dateKey}</div>
          {#if summary.firstDay.titles.length}
            <div class="text-[11px] opacity-50 mt-1 truncate" title={summary.firstDay.titles.join(', ')}>
              {summary.firstDay.titles.join(' · ')}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
{/if}
