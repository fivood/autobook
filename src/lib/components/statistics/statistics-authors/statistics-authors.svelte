<script lang="ts">
  import type {
    BooksDbBookData,
    BooksDbManualBook,
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import {
    computeAuthorsList,
    computeBooksList
  } from '$lib/components/statistics/books-summary';
  import { resolvePeriod } from '$lib/components/statistics/statistics-period';

  export let statistics: BooksDbStatistic[] = [];
  export let manualBooks: BooksDbManualBook[] = [];
  export let dataMetas: Pick<BooksDbBookData, 'title' | 'characters'>[] = [];
  export let startDate: string;
  export let endDate: string;
  export let startDayHours: number;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  $: bounds = resolvePeriod(startDate, endDate, startDayHours);
  $: authors = bounds
    ? computeAuthorsList({
        period: bounds,
        statistics,
        manualBooks,
        dataMetas,
        titleFilter
      })
    : [];
  $: totalSeconds = authors.reduce((a, x) => a + x.seconds, 0);

  // How many books have no author metadata? Surface as a hint so users
  // realize they need to fill in manualBook.author to see attribution.
  $: booksWithoutAuthor = (() => {
    if (!bounds) return 0;
    const list = computeBooksList({
      period: bounds,
      statistics,
      manualBooks,
      dataMetas,
      titleFilter
    });
    return list.filter((b) => !b.author).length;
  })();

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

  function percent(n: number): number {
    return totalSeconds > 0 ? Math.round((n / totalSeconds) * 100) : 0;
  }
</script>

<div class="my-4 opacity-80">作者 · {statisticsDateRangeLabel} · 共 {authors.length} 位</div>

{#if booksWithoutAuthor > 0}
  <div
    class="my-3 text-xs opacity-70 rounded border-l-2 pl-3 py-2"
    style="border-color: var(--accent-color, #5f7e7b);"
  >
    有 <b>{booksWithoutAuthor}</b> 本书没填作者，都归到「未知作者」。想改的话打开手动录入 dialog（右上 ✏️）录入或编辑该书的元数据。
  </div>
{/if}

{#if authors.length === 0}
  <div class="opacity-60 text-sm py-6">此时段没有阅读记录</div>
{:else}
  <div class="flex flex-col gap-2">
    {#each authors as row (row.author)}
      <div class="rounded border border-gray-500/25 p-3">
        <div class="flex items-baseline justify-between gap-3">
          <div class="text-base font-medium truncate">{row.author}</div>
          <div class="tabular-nums text-sm opacity-80 shrink-0">
            {formatDuration(row.seconds)}
            <span class="opacity-60 text-[11px]">· {percent(row.seconds)}%</span>
          </div>
        </div>
        <div class="text-[11px] opacity-60 mt-1">
          {row.books.length} 本书 · {formatChars(row.chars)} 字 · {row.days} 天{row.completed
            ? ` · 完成 ${row.completed}`
            : ''}
        </div>
        <div class="flex flex-wrap gap-1 mt-2">
          {#each row.books as title (title)}
            <span
              class="text-[11px] px-2 py-0.5 rounded-full border border-gray-500/25 truncate max-w-[16rem]"
              title={title}
            >
              {title}
            </span>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}
