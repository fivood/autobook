<script lang="ts">
  import type {
    BooksDbBookData,
    BooksDbManualBook,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import {
    computeBooksList,
    type BookRow
  } from '$lib/components/statistics/books-summary';
  import { resolvePeriod } from '$lib/components/statistics/statistics-period';
  import { t, tImmediate } from '$lib/i18n';
  import { onDestroy } from 'svelte';

  export let statistics: BooksDbStatistic[] = [];
  export let manualBooks: BooksDbManualBook[] = [];
  export let dataMetas: Pick<BooksDbBookData, 'title' | 'characters'>[] = [];
  export let startDate: string;
  export let endDate: string;
  export let startDayHours: number;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  type SortKey = 'seconds' | 'chars' | 'days' | 'progress' | 'lastDateKey' | 'title';
  let sortKey: SortKey = 'seconds';
  let sortDesc = true;

  $: bounds = resolvePeriod(startDate, endDate, startDayHours);
  $: rows = bounds
    ? computeBooksList({
        period: bounds,
        statistics,
        manualBooks,
        dataMetas,
        titleFilter
      })
    : [];

  $: sortedRows = [...rows].sort((a, b) => {
    const av = valueFor(a, sortKey);
    const bv = valueFor(b, sortKey);
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return sortDesc ? -cmp : cmp;
  });

  function valueFor(r: BookRow, k: SortKey): number | string {
    if (k === 'title') return r.title;
    if (k === 'lastDateKey') return r.lastDateKey ?? '';
    return (r as any)[k] ?? 0;
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) sortDesc = !sortDesc;
    else {
      sortKey = k;
      sortDesc = k !== 'title';
    }
  }

  // Cover blob URL cache — build once per book row, revoke on unmount /
  // when the row disappears from the current period. Cheaper than
  // recomputing on every re-render (period / filter change).
  const coverUrlCache = new Map<string, string>();
  $: {
    const seenKeys = new Set(rows.filter((r) => r.coverBlob).map((r) => r.title));
    for (const [title, url] of coverUrlCache) {
      if (!seenKeys.has(title)) {
        URL.revokeObjectURL(url);
        coverUrlCache.delete(title);
      }
    }
    for (const r of rows) {
      if (r.coverBlob && !coverUrlCache.has(r.title)) {
        coverUrlCache.set(r.title, URL.createObjectURL(r.coverBlob));
      }
    }
  }
  onDestroy(() => {
    for (const url of coverUrlCache.values()) URL.revokeObjectURL(url);
    coverUrlCache.clear();
  });

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

  function arrow(k: SortKey): string {
    if (sortKey !== k) return '';
    return sortDesc ? ' ↓' : ' ↑';
  }
</script>

<div class="my-4 opacity-80">
  {$t('stats.books.header', { range: statisticsDateRangeLabel, n: rows.length })}
</div>

{#if rows.length === 0}
  <div class="opacity-60 text-sm py-6">{$t('stats.empty.period')}</div>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr class="text-left opacity-60 text-xs border-b border-gray-500/25">
          <th class="py-1.5 pr-3 w-12"></th>
          <th
            class="py-1.5 pr-3 cursor-pointer select-none hover:opacity-100"
            on:click={() => toggleSort('title')}
          >
            {$t('stats.books.colTitle')}{arrow('title')}
          </th>
          <th class="py-1.5 pr-3">{$t('stats.books.colMeta')}</th>
          <th
            class="py-1.5 pr-3 tabular-nums text-right cursor-pointer select-none hover:opacity-100"
            on:click={() => toggleSort('seconds')}
          >
            {$t('stats.books.colTime')}{arrow('seconds')}
          </th>
          <th
            class="py-1.5 pr-3 tabular-nums text-right cursor-pointer select-none hover:opacity-100"
            on:click={() => toggleSort('chars')}
          >
            {$t('stats.books.colChars')}{arrow('chars')}
          </th>
          <th
            class="py-1.5 pr-3 tabular-nums text-right cursor-pointer select-none hover:opacity-100"
            on:click={() => toggleSort('days')}
          >
            {$t('stats.books.colDays')}{arrow('days')}
          </th>
          <th
            class="py-1.5 pr-3 tabular-nums text-right cursor-pointer select-none hover:opacity-100 w-28"
            on:click={() => toggleSort('progress')}
          >
            {$t('stats.books.colProgress')}{arrow('progress')}
          </th>
          <th
            class="py-1.5 pl-3 whitespace-nowrap cursor-pointer select-none hover:opacity-100"
            on:click={() => toggleSort('lastDateKey')}
          >
            {$t('stats.books.colRecent')}{arrow('lastDateKey')}
          </th>
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as row (row.title)}
          {@const coverUrl = row.coverBlob ? coverUrlCache.get(row.title) : undefined}
          <tr class="border-b border-gray-500/15 hover:bg-gray-500/5">
            <td class="py-1.5 pr-3">
              {#if coverUrl}
                <img
                  src={coverUrl}
                  alt=""
                  class="h-10 w-7 object-cover rounded-sm shadow-sm"
                  loading="lazy"
                />
              {:else}
                <div
                  class="h-10 w-7 rounded-sm border border-gray-500/25 opacity-50"
                  aria-hidden="true"
                ></div>
              {/if}
            </td>
            <td class="py-1.5 pr-3 min-w-0">
              <div class="truncate max-w-[22rem]" title={row.title}>
                {row.title}
                {#if row.completed > 0}
                  <span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-green-600/25 text-green-700 dark:text-green-300">{$t('stats.books.doneTag')}</span>
                {/if}
              </div>
              {#if row.tags && row.tags.length}
                <div class="text-[10px] opacity-50 mt-0.5 truncate max-w-[22rem]">
                  {row.tags.join(' · ')}
                </div>
              {/if}
            </td>
            <td class="py-1.5 pr-3 text-xs opacity-80">
              {#if row.author || row.publisher}
                <div class="truncate max-w-[10rem]" title={[row.author, row.translator ? `${tImmediate('stats.books.translatorPrefix')} ${row.translator}` : '', row.publisher].filter(Boolean).join(' · ')}>
                  {row.author ?? ''}
                </div>
                {#if row.publisher || row.publishedYear}
                  <div class="text-[10px] opacity-60 truncate max-w-[10rem]">
                    {[row.publisher, row.publishedYear].filter(Boolean).join(' · ')}
                  </div>
                {/if}
              {:else}
                <span class="opacity-40">—</span>
              {/if}
            </td>
            <td class="py-1.5 pr-3 tabular-nums text-right">{formatDuration(row.seconds)}</td>
            <td class="py-1.5 pr-3 tabular-nums text-right">{formatChars(row.chars)}</td>
            <td class="py-1.5 pr-3 tabular-nums text-right">{row.days}</td>
            <td class="py-1.5 pr-3">
              {#if row.totalCharacters}
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-gray-500/20 rounded overflow-hidden">
                    <div
                      class="h-full"
                      style="width:{Math.round(row.progress * 100)}%;background:var(--accent-color, #5f7e7b)"
                    ></div>
                  </div>
                  <span class="tabular-nums text-[11px] w-8 text-right">{Math.round(row.progress * 100)}%</span>
                </div>
              {:else}
                <span class="opacity-40 text-xs">—</span>
              {/if}
            </td>
            <td class="py-1.5 pl-3 text-xs opacity-70 whitespace-nowrap">
              {row.lastDateKey ?? '—'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
