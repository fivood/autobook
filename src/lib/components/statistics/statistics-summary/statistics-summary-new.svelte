<script lang="ts">
  /**
   * New SUMMARY tab (1.20.5). Replaces the 681-line paginated table.
   * Per-day rows with expand-to-see-per-title breakdown; per-title
   * inline edit + delete via the existing dispatch plumbing so no
   * changes to statistics-content's handlers are needed.
   */
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import {
    computeDailySummary,
    type DailySummaryRow,
    type DailyTitleContribution
  } from '$lib/components/statistics/daily-summary';
  import type {
    StatisticsDeleteRequest,
    StatisticsEditRequest
  } from '$lib/components/statistics/statistics-summary/statistics-summary';
  import { resolvePeriod } from '$lib/components/statistics/statistics-period';
  import {
    faChevronDown,
    faChevronRight,
    faPen,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { t, tImmediate } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  export let statistics: BooksDbStatistic[] = [];
  export let startDate: string;
  export let endDate: string;
  export let startDayHours: number;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  const dispatch = createEventDispatcher<{
    delete: StatisticsDeleteRequest;
    edit: StatisticsEditRequest;
  }>();

  $: DOW = [
    $t('stats.dow.sun'),
    $t('stats.dow.mon'),
    $t('stats.dow.tue'),
    $t('stats.dow.wed'),
    $t('stats.dow.thu'),
    $t('stats.dow.fri'),
    $t('stats.dow.sat')
  ];

  $: bounds = resolvePeriod(startDate, endDate, startDayHours);
  $: summary = bounds
    ? computeDailySummary({ period: bounds, statistics, titleFilter })
    : null;

  let expanded = new Set<string>();
  let editing: { dateKey: string; title: string } | null = null;
  let editMinutes = 0;
  let editChars = 0;
  let editResetMinMax = false;

  function toggleExpanded(dateKey: string) {
    if (expanded.has(dateKey)) expanded.delete(dateKey);
    else expanded.add(dateKey);
    expanded = expanded;
  }

  function startEdit(dateKey: string, tc: DailyTitleContribution) {
    editing = { dateKey, title: tc.title };
    editMinutes = Math.round(tc.readingTime / 60);
    editChars = tc.charactersRead;
    editResetMinMax = false;
  }

  function cancelEdit() {
    editing = null;
  }

  function saveEdit() {
    if (!editing) return;
    dispatch('edit', {
      dateKey: editing.dateKey,
      title: editing.title,
      newReadingTime: Math.max(0, Math.round(editMinutes * 60)),
      newCharactersRead: Math.max(0, Math.floor(editChars)),
      resetMinMaxValues: editResetMinMax
    });
    editing = null;
  }

  function requestDelete(dateKey: string, title: string) {
    const set = new Set<string>();
    set.add(title);
    dispatch('delete', {
      startDate: dateKey,
      endDate: dateKey,
      titlesToCheck: set,
      takeAsIs: true
    });
  }

  function requestDeleteDay(row: DailySummaryRow) {
    const set = new Set<string>();
    for (const tc of row.titles) set.add(tc.title);
    dispatch('delete', {
      startDate: row.dateKey,
      endDate: row.dateKey,
      titlesToCheck: set,
      takeAsIs: true
    });
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

  function formatChars(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return `${n}`;
  }

  function weekdayOf(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return DOW[new Date(y, m - 1, d).getDay()];
  }
</script>

<div class="my-4 opacity-80">
  {$t('stats.summary.header', { range: statisticsDateRangeLabel })}
</div>

{#if summary}
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.readDays')}</div>
      <div class="text-xl font-medium tabular-nums">{summary.activeDays}</div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.totalTime')}</div>
      <div class="text-xl font-medium tabular-nums">{formatDuration(summary.totalSeconds)}</div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.totalChars')}</div>
      <div class="text-xl font-medium tabular-nums">{formatChars(summary.totalChars)}</div>
    </div>
    <div class="rounded border border-gray-500/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.completedBooks')}</div>
      <div class="text-xl font-medium tabular-nums">{summary.totalCompleted}</div>
    </div>
  </div>

  {#if summary.rows.length === 0}
    <div class="opacity-60 text-sm py-6">{$t('stats.empty.period')}</div>
  {:else}
    <div class="rounded border border-gray-500/25 overflow-hidden">
      <div
        class="grid gap-2 px-3 py-2 text-[11px] opacity-60 border-b border-gray-500/25"
        style="grid-template-columns: 1.25rem 6rem 1.5rem 1fr 1fr 1fr 1fr 2rem;"
      >
        <div></div>
        <div>{$t('stats.summary.colDate')}</div>
        <div>{$t('stats.summary.colWeek')}</div>
        <div class="text-right">{$t('stats.summary.colTime')}</div>
        <div class="text-right">{$t('stats.summary.colChars')}</div>
        <div class="text-right">{$t('stats.summary.colSpeed')}</div>
        <div class="text-right">{$t('stats.summary.colBooks')}</div>
        <div></div>
      </div>
      {#each summary.rows as row (row.dateKey)}
        {@const open = expanded.has(row.dateKey)}
        <div
          class="grid gap-2 px-3 py-2 text-sm tabular-nums items-center hover:bg-gray-500/5 border-b border-gray-500/15"
          style="grid-template-columns: 1.25rem 6rem 1.5rem 1fr 1fr 1fr 1fr 2rem;"
        >
          <button
            type="button"
            class="opacity-60 hover:opacity-100 text-xs"
            title={open
              ? tImmediate('stats.summary.collapse')
              : tImmediate('stats.summary.expand', { n: row.titles.length })}
            on:click={() => toggleExpanded(row.dateKey)}
          >
            <Fa icon={open ? faChevronDown : faChevronRight} />
          </button>
          <div class="whitespace-nowrap">{row.dateKey}</div>
          <div class="opacity-70 text-xs">{weekdayOf(row.dateKey)}</div>
          <div class="text-right">{formatDuration(row.seconds)}</div>
          <div class="text-right">{formatChars(row.chars)}</div>
          <div class="text-right opacity-80">
            {row.weightedSpeedCharsPerHour ? formatChars(row.weightedSpeedCharsPerHour) : '—'}
          </div>
          <div class="text-right">
            {row.titles.length}{row.completedBooks
              ? tImmediate('stats.summary.completedTail', { n: row.completedBooks })
              : ''}
          </div>
          <button
            type="button"
            class="opacity-50 hover:opacity-100 hover:text-red-500 text-xs"
            title={$t('stats.summary.deleteDay')}
            on:click={() => requestDeleteDay(row)}
          >
            <Fa icon={faTrash} />
          </button>
        </div>
        {#if open}
          <div class="bg-gray-500/5 px-3 pt-2 pb-3 border-b border-gray-500/15">
            {#each row.titles as tc (tc.title)}
              {@const isEditing =
                editing && editing.dateKey === row.dateKey && editing.title === tc.title}
              <div
                class="grid gap-2 py-1.5 text-xs items-center"
                style="grid-template-columns: 1fr 5rem 5rem 5rem 4rem;"
              >
                <div class="truncate" title={tc.title}>{tc.title}</div>
                {#if isEditing}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="px-1 py-0.5 rounded border border-gray-500/40 bg-transparent tabular-nums w-full"
                    bind:value={editMinutes}
                    placeholder={tImmediate('stats.summary.minutesPh')}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="px-1 py-0.5 rounded border border-gray-500/40 bg-transparent tabular-nums w-full"
                    bind:value={editChars}
                    placeholder={tImmediate('stats.summary.charsPh')}
                  />
                  <label class="flex items-center gap-1 text-[10px] opacity-80" title={tImmediate('stats.summary.resetExtremeHint')}>
                    <input type="checkbox" bind:checked={editResetMinMax} />
                    {$t('stats.summary.resetExtreme')}
                  </label>
                  <div class="flex gap-1 justify-end">
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded border border-gray-500/40 text-[10px] hover:bg-gray-500/10"
                      on:click={saveEdit}
                    >
                      {$t('stats.summary.save')}
                    </button>
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded border border-gray-500/40 text-[10px] hover:bg-gray-500/10"
                      on:click={cancelEdit}
                    >
                      {$t('stats.summary.cancel')}
                    </button>
                  </div>
                {:else}
                  <div class="text-right tabular-nums">{formatDuration(tc.readingTime)}</div>
                  <div class="text-right tabular-nums">{formatChars(tc.charactersRead)}</div>
                  <div class="text-right tabular-nums opacity-70">
                    {tc.lastReadingSpeed ? formatChars(tc.lastReadingSpeed) : '—'}
                  </div>
                  <div class="flex gap-2 justify-end">
                    <button
                      type="button"
                      class="opacity-50 hover:opacity-100"
                      title={$t('stats.summary.editRow')}
                      on:click={() => startEdit(row.dateKey, tc)}
                    >
                      <Fa icon={faPen} />
                    </button>
                    <button
                      type="button"
                      class="opacity-50 hover:opacity-100 hover:text-red-500"
                      title={$t('stats.summary.deleteRow')}
                      on:click={() => requestDelete(row.dateKey, tc.title)}
                    >
                      <Fa icon={faTrash} />
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
