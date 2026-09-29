<script lang="ts">
  /**
   * New SUMMARY tab (1.20.5). Replaces the 681-line paginated table.
   * Per-day rows with expand-to-see-per-title breakdown; per-title
   * inline edit + delete via the existing dispatch plumbing so no
   * changes to statistics-content's handlers are needed.
   */
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import { formatChars, formatDuration } from '$lib/components/statistics/statistics-format';
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
    const next = new Set(expanded);
    if (next.has(dateKey)) next.delete(dateKey);
    else next.add(dateKey);
    expanded = next;
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

  /**
   * The share of a row that came from playback, when there is one.
   *
   * Only the playback part is broken out: those two numbers come from the
   * engines themselves (sentences spoken, characters revealed), while the
   * totals beside them are derived from reading position. Presenting them as
   * parts of one sum would be a lie — under playback the position-based total
   * can even move backwards. So this reads as an annotation, not a subtotal.
   */
  function playbackSplit(tc: { raw: BooksDbStatistic }): string {
    const stat = tc.raw;
    const parts: string[] = [];
    if (stat.ttsSeconds || stat.ttsCharacters) {
      parts.push(
        tImmediate('stats.summary.viaTts', {
          time: formatDuration(stat.ttsSeconds || 0),
          chars: formatChars(stat.ttsCharacters || 0)
        })
      );
    }
    if (stat.typewriterSeconds || stat.typewriterCharacters) {
      parts.push(
        tImmediate('stats.summary.viaTypewriter', {
          time: formatDuration(stat.typewriterSeconds || 0),
          chars: formatChars(stat.typewriterCharacters || 0)
        })
      );
    }
    return parts.join(' · ');
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
    <div class="rounded border border-current/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.readDays')}</div>
      <div class="text-xl font-medium tabular-nums">{summary.activeDays}</div>
    </div>
    <div class="rounded border border-current/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.totalTime')}</div>
      <div class="text-xl font-medium tabular-nums">{formatDuration(summary.totalSeconds)}</div>
    </div>
    <div class="rounded border border-current/30 p-3">
      <div class="text-xs opacity-70">
        {summary.totalPages ? $t('stats.summary.totalCharsAndPages') : $t('stats.summary.totalChars')}
      </div>
      <div class="text-xl font-medium tabular-nums">
        {formatChars(summary.totalChars)}{summary.totalPages
          ? ` · ${tImmediate('stats.summary.pagesValue', { n: summary.totalPages })}`
          : ''}
      </div>
    </div>
    <div class="rounded border border-current/30 p-3">
      <div class="text-xs opacity-70">{$t('stats.summary.completedBooks')}</div>
      <div class="text-xl font-medium tabular-nums">{summary.totalCompleted}</div>
    </div>
  </div>

  {#if summary.rows.length === 0}
    <div class="opacity-60 text-sm py-6">{$t('stats.empty.period')}</div>
  {:else}
    <div class="rounded border border-current/25 overflow-hidden">
      <div
        class="grid gap-2 px-3 py-2 text-[11px] opacity-60 border-b border-current/25"
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
          class="grid gap-2 px-3 py-2 text-sm tabular-nums items-center hover:bg-current/5 border-b border-current/15"
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
          <div class="text-right">
            {row.chars ? formatChars(row.chars) : ''}{row.pages
              ? `${row.chars ? ' · ' : ''}${tImmediate('stats.summary.pagesValue', { n: row.pages })}`
              : ''}{!row.chars && !row.pages ? '0' : ''}
          </div>
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
            class="opacity-50 hover:opacity-100 hover-danger text-xs"
            title={$t('stats.summary.deleteDay')}
            on:click={() => requestDeleteDay(row)}
          >
            <Fa icon={faTrash} />
          </button>
        </div>
        {#if open}
          <div class="bg-current/5 px-3 pt-2 pb-3 border-b border-current/15">
            {#each row.titles as tc (tc.title)}
              {@const isEditing =
                editing && editing.dateKey === row.dateKey && editing.title === tc.title}
              <div
                class="grid gap-2 py-1.5 text-xs items-center"
                style="grid-template-columns: 1fr 5rem 5rem 5rem 4rem;"
              >
                <div class="min-w-0">
                  <div class="truncate" title={tc.title}>{tc.title}</div>
                  {#if playbackSplit(tc)}
                    <div class="truncate text-[10px] opacity-55">{playbackSplit(tc)}</div>
                  {/if}
                </div>
                {#if isEditing}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="px-1 py-0.5 rounded border border-current/40 bg-transparent tabular-nums w-full"
                    bind:value={editMinutes}
                    placeholder={tImmediate('stats.summary.minutesPh')}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    class="px-1 py-0.5 rounded border border-current/40 bg-transparent tabular-nums w-full"
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
                      class="px-2 py-0.5 rounded border border-current/40 text-[10px] hover:bg-current/10"
                      on:click={saveEdit}
                    >
                      {$t('stats.summary.save')}
                    </button>
                    <button
                      type="button"
                      class="px-2 py-0.5 rounded border border-current/40 text-[10px] hover:bg-current/10"
                      on:click={cancelEdit}
                    >
                      {$t('stats.summary.cancel')}
                    </button>
                  </div>
                {:else}
                  <div class="text-right tabular-nums">{formatDuration(tc.readingTime)}</div>
                  <div class="text-right tabular-nums">
                    {#if tc.raw.sectionsTotal}
                      {tImmediate('stats.summary.pagesOfTotal', {
                        read: tc.raw.sectionsRead ?? 0,
                        total: tc.raw.sectionsTotal
                      })}
                    {:else}
                      {formatChars(tc.charactersRead)}
                    {/if}
                  </div>
                  <div class="text-right tabular-nums opacity-70">
                    {#if tc.raw.sectionsTotal}
                      —
                    {:else}
                      {tc.lastReadingSpeed ? formatChars(tc.lastReadingSpeed) : '—'}
                    {/if}
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
                      class="opacity-50 hover:opacity-100 hover-danger"
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
