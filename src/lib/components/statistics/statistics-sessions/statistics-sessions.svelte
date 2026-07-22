<script lang="ts">
  /**
   * Sessions tab (Phase C, 1.20.0): session-list explorer scoped by the
   * shared period + title filter. Reuses `computePeriodSummary` for the
   * aggregate stats block, then renders the raw sessions list underneath.
   */
  import type {
    BooksDbSession,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import { computePeriodSummary } from '$lib/components/statistics/session-summary';
  import { resolvePeriod } from '$lib/components/statistics/statistics-period';
  import { t } from '$lib/i18n';

  export let statistics: BooksDbStatistic[] = [];
  export let sessions: BooksDbSession[] = [];
  export let startDate: string;
  export let endDate: string;
  export let startDayHours: number;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  $: bounds = resolvePeriod(startDate, endDate, startDayHours);
  $: summary = bounds
    ? computePeriodSummary({
        period: bounds,
        statistics,
        sessions,
        titleFilter
      })
    : null;

  $: inRangeSessions = (bounds
    ? sessions.filter(
        (s) =>
          s.startTs >= bounds!.startTs &&
          s.startTs < bounds!.endTs &&
          (!titleFilter.size || titleFilter.get(s.title))
      )
    : []
  ).sort((a, b) => b.startTs - a.startTs);

  const PAGE_SIZE = 100;
  let visible = PAGE_SIZE;
  $: if (inRangeSessions) {
    // Reset paging when the period / filter changes and the list shrinks
    // below the current cursor.
    if (visible > inRangeSessions.length) visible = PAGE_SIZE;
  }

  function formatDuration(sec: number): string {
    if (sec >= 3600) {
      const h = Math.floor(sec / 3600);
      const m = Math.round((sec % 3600) / 60);
      return m ? `${h}h${m}m` : `${h}h`;
    }
    if (sec >= 60) return `${Math.round(sec / 60)}m`;
    return `${Math.round(sec)}s`;
  }

  function formatDateTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  $: DOW = [
    $t('stats.dow.sun'),
    $t('stats.dow.mon'),
    $t('stats.dow.tue'),
    $t('stats.dow.wed'),
    $t('stats.dow.thu'),
    $t('stats.dow.fri'),
    $t('stats.dow.sat')
  ];
  function weekdayLabel(ts: number): string {
    return DOW[new Date(ts).getDay()];
  }
</script>

<div class="my-4 opacity-80">
  {$t('stats.sessions.header', { range: statisticsDateRangeLabel })}
</div>

{#if summary?.sessionStats}
  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 my-4">
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.sessions.count')}</div>
      <div class="text-xl font-medium tabular-nums">{summary.sessionStats.count}</div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.sessions.totalTime')}</div>
      <div class="text-xl font-medium tabular-nums">
        {formatDuration(summary.sessionStats.totalSeconds)}
      </div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.sessions.median')}</div>
      <div class="text-xl font-medium tabular-nums">
        {formatDuration(summary.sessionStats.medianSeconds)}
      </div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.sessions.p95')}</div>
      <div class="text-xl font-medium tabular-nums">
        {formatDuration(summary.sessionStats.p95Seconds)}
      </div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.sessions.longest')}</div>
      <div class="text-xl font-medium tabular-nums">
        {formatDuration(summary.sessionStats.longestSeconds)}
      </div>
    </div>
  </div>
{:else}
  <div class="opacity-60 text-sm py-6">
    {$t('stats.sessions.emptyPeriod')}
  </div>
{/if}

{#if inRangeSessions.length}
  <section class="my-6">
    <div class="flex items-baseline justify-between mb-2">
      <h3 class="text-lg">{$t('stats.sessions.list')}</h3>
      <span class="text-[11px] opacity-60">
        {$t('stats.sessions.listTotal', {
          total: inRangeSessions.length,
          shown:
            inRangeSessions.length > visible
              ? $t('stats.sessions.listShownTail', { n: visible })
              : ''
        })}
      </span>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm tabular-nums border-collapse">
        <thead>
          <tr class="text-left opacity-60 text-xs border-b border-gray-500/25">
            <th class="py-1.5 pr-3">{$t('stats.sessions.colStart')}</th>
            <th class="py-1.5 pr-3">{$t('stats.sessions.colWeek')}</th>
            <th class="py-1.5 pr-3">{$t('stats.sessions.colDur')}</th>
            <th class="py-1.5 pr-3 text-right">{$t('stats.sessions.colChars')}</th>
            <th class="py-1.5 pl-3">{$t('stats.sessions.colTitle')}</th>
          </tr>
        </thead>
        <tbody>
          {#each inRangeSessions.slice(0, visible) as s (s.id)}
            <tr class="border-b border-gray-500/15 hover:bg-gray-500/5">
              <td class="py-1 pr-3 whitespace-nowrap">{formatDateTime(s.startTs)}</td>
              <td class="py-1 pr-3 opacity-70">{weekdayLabel(s.startTs)}</td>
              <td class="py-1 pr-3">{formatDuration(s.durationSec)}</td>
              <td class="py-1 pr-3 text-right">{s.charsRead || ''}</td>
              <td class="py-1 pl-3 truncate max-w-[24rem]" title={s.title}>{s.title}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if inRangeSessions.length > visible}
      <div class="flex justify-center mt-3">
        <button
          class="text-sm px-4 py-1.5 rounded border border-gray-500/40 hover:bg-gray-500/10"
          on:click={() => (visible = Math.min(inRangeSessions.length, visible + PAGE_SIZE))}
        >
          {$t('stats.sessions.more', {
            n: Math.min(PAGE_SIZE, inRangeSessions.length - visible)
          })}
        </button>
      </div>
    {/if}
  </section>
{/if}
