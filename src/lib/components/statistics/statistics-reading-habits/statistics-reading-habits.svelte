<script lang="ts">
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import {
    aggregateReadingHabits,
    type ReadingHabitsSummary
  } from '$lib/functions/reading-habits';
  import { startDayHoursForTracker$ } from '$lib/data/store';
  import { toTimeString } from '$lib/functions/statistic-util';

  export let statistics: BooksDbStatistic[] = [];
  export let startDate: string;
  export let endDate: string;
  export let titleFilter: Map<string, boolean>;

  let summary: ReadingHabitsSummary | undefined;

  $: if (startDate && endDate) {
    summary = aggregateReadingHabits(statistics, {
      startDate,
      endDate,
      startDayHoursForTracker: $startDayHoursForTracker$,
      titleFilter
    });
  }

  const dowLabels = ['日', '一', '二', '三', '四', '五', '六'];

  $: hourlyMax = summary ? Math.max(1, ...summary.hourly) : 1;
  $: cellMax = summary
    ? Math.max(1, ...summary.dowHour.flatMap((row) => row))
    : 1;
  $: bucketedPct = summary && summary.totalReadingTime > 0
    ? Math.round((summary.totalWithBucket / summary.totalReadingTime) * 100)
    : 0;
  $: peakHourLabel = summary && summary.peakHour >= 0
    ? `${`${summary.peakHour}`.padStart(2, '0')}:00–${`${(summary.peakHour + 1) % 24}`.padStart(2, '0')}:00`
    : '—';
  $: peakDowLabel = summary && summary.peakDow >= 0
    ? `周${dowLabels[summary.peakDow]}`
    : '—';

  function cellStyle(sec: number): string {
    if (!sec) return '';
    // Map to a translucent shade of currentColor so it plays nice with either
    // theme; opacity ramps 0.15 → 0.85 based on relative intensity.
    const t = Math.max(0.15, Math.min(0.85, 0.15 + 0.7 * (sec / cellMax)));
    return `background-color: currentColor; opacity:${t};`;
  }
</script>

{#if summary && summary.totalWithBucket > 0}
  <section class="mt-8">
    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
      <h3 class="text-lg">阅读习惯</h3>
      <div class="text-xs opacity-70">
        阅读高峰 <span class="font-medium">{peakHourLabel}</span> · 最活跃
        <span class="font-medium">{peakDowLabel}</span>
        {#if bucketedPct > 0 && bucketedPct < 95}
          · <span title="早期数据没有记录小时信息">
            仅 {bucketedPct}% 的时长有小时数据
          </span>
        {/if}
      </div>
    </div>

    <div class="flex items-end gap-[2px] h-20 border-b border-gray-500/20">
      {#each summary.hourly as sec, hour}
        <div
          class="flex-1 flex flex-col items-center justify-end"
          title="{`${hour}`.padStart(2, '0')}:00 — {toTimeString(sec)}"
        >
          <div
            class="w-full bg-current/60 rounded-t"
            style="height:{(sec / hourlyMax) * 100}%;min-height:{sec ? 2 : 0}px;opacity:.55"
          ></div>
        </div>
      {/each}
    </div>
    <div class="flex gap-[2px] mt-1 mb-3">
      {#each summary.hourly as _, hour}
        <div class="flex-1 text-[10px] opacity-60 text-center">
          {hour % 3 === 0 ? hour : ''}
        </div>
      {/each}
    </div>

    <div class="overflow-x-auto">
      <div class="inline-grid gap-[2px]" style="grid-template-columns: 2rem repeat(24, minmax(1rem, 1fr));">
        <div></div>
        {#each Array(24) as _, hour}
          <div class="text-[10px] opacity-60 text-center">
            {hour % 3 === 0 ? `${`${hour}`.padStart(2, '0')}` : ''}
          </div>
        {/each}
        {#each dowLabels as label, dowIndex (label)}
          <div class="text-xs opacity-70 flex items-center justify-end pr-1">{label}</div>
          {#each summary.dowHour[dowIndex] as sec, hour}
            <div
              class="h-4 rounded-sm bg-gray-500/10"
              style={cellStyle(sec)}
              title="周{label} {`${hour}`.padStart(2, '0')}:00 — {sec ? toTimeString(sec) : '—'}"
            ></div>
          {/each}
        {/each}
      </div>
    </div>
  </section>
{/if}
