<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import type {
    BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import type { BooksDbV10BookMetadata } from '$lib/data/database/books-db/versions/v10/books-db-v10';
  import { aggregateMetadataStats, type MetadataStatsSummary } from '$lib/functions/metadata-stats';
  import { database } from '$lib/data/store';
  import { toTimeString } from '$lib/functions/statistic-util';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';

  export let statistics: BooksDbStatistic[] = [];
  export let startDate: string;
  export let endDate: string;
  export let titleFilter: Map<string, boolean>;
  export let statisticsDateRangeLabel: string;

  let metadataList: BooksDbV10BookMetadata[] = [];
  let isLoading = true;
  let summary: MetadataStatsSummary | undefined;

  onMount(async () => {
    try {
      metadataList = await database.getAllBookMetadata();
    } finally {
      isLoading = false;
    }
  });

  $: if (!isLoading && startDate && endDate) {
    summary = aggregateMetadataStats(statistics, metadataList, {
      startDate,
      endDate,
      titleFilter
    });
  }

  $: authorMax = summary ? Math.max(1, ...summary.authors.map((a) => a.readingTime)) : 1;
  $: languageMax = summary ? Math.max(1, ...summary.languages.map((l) => l.readingTime)) : 1;
  $: topAuthors = summary ? summary.authors.slice(0, 10) : [];
  $: topSubjects = summary ? summary.subjects.slice(0, 40) : [];
  $: hasAny = summary
    ? summary.authors.length + summary.languages.length + summary.subjects.length +
        summary.completedBooks.length >
      0
    : false;

  $: hourlyMax = summary ? Math.max(1, ...summary.hourly) : 1;
  $: hasHourly = summary ? summary.hourlyTotal > 0 : false;
</script>

{#if isLoading}
  <div class="flex items-center justify-center py-16 text-4xl">
    <Fa icon={faSpinner} spin />
  </div>
{:else if summary}
  <div class="my-4 opacity-80">按书籍元数据聚合 · {statisticsDateRangeLabel}</div>

  {#if !hasAny}
    <div class="opacity-60 text-center py-8">
      当前范围下没有可用的书籍元数据。<br />
      导入 EPUB 会自动带入作者/分类；手动录入的纸质书可在弹窗里填作者。
    </div>
  {/if}

  {#if hasHourly}
    <section class="my-6">
      <h3 class="text-lg mb-2">阅读时段分布（24 小时）</h3>
      <div class="flex items-end gap-[2px] h-24 border-b border-gray-500/20">
        {#each summary.hourly as sec, hour}
          <div
            class="flex-1 flex flex-col items-center justify-end gap-1"
            title="{`${hour}`.padStart(2, '0')}:00 – {toTimeString(sec)}"
          >
            <div
              class="w-full bg-current/60 rounded-t"
              style="height:{(sec / hourlyMax) * 100}%;min-height:2px;opacity:.6"
            ></div>
          </div>
        {/each}
      </div>
      <div class="flex gap-[2px] mt-1">
        {#each summary.hourly as _, hour}
          <div class="flex-1 text-[10px] opacity-60 text-center">
            {hour % 3 === 0 ? hour : ''}
          </div>
        {/each}
      </div>
      <div class="text-xs opacity-60 mt-1">
        统计从 v11 起记录；此前的阅读时长不带小时信息，不计入本图。
      </div>
    </section>
  {/if}

  {#if summary.completedBooks.length}
    <section class="my-6">
      <h3 class="text-lg mb-2">读完的书</h3>
      <div class="flex flex-col gap-1">
        {#each summary.completedBooks as b (b.title + b.dateKey)}
          <div class="grid grid-cols-[7rem_1fr_auto] gap-3 items-center py-1 border-b border-gray-500/20 text-sm">
            <div class="opacity-60 tabular-nums">{b.dateKey}</div>
            <div class="truncate" title={b.title}>
              {b.title}
              {#if b.author}
                <span class="opacity-60 text-xs">· {b.author}</span>
              {/if}
            </div>
            <div class="opacity-70 tabular-nums text-right">
              {toTimeString(b.readingTime)}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if topAuthors.length}
    <section class="my-6">
      <h3 class="text-lg mb-2">
        Top 作者
        {#if summary.unattributedTime > 0}
          <span class="text-xs opacity-60">
            （另有 {toTimeString(summary.unattributedTime)} 无作者信息）
          </span>
        {/if}
      </h3>
      <div class="flex flex-col gap-1">
        {#each topAuthors as a, i (a.author)}
          <div class="grid grid-cols-[2rem_1fr_5rem] items-center gap-3 text-sm py-1">
            <div class="opacity-60 tabular-nums">#{i + 1}</div>
            <div>
              <div class="truncate" title={a.author}>{a.author}</div>
              <div class="h-1.5 rounded bg-gray-500/15 overflow-hidden mt-1">
                <div
                  class="h-full bg-current/60 rounded"
                  style="width:{(a.readingTime / authorMax) * 100}%;opacity:.6"
                ></div>
              </div>
              <div class="text-[11px] opacity-60 mt-0.5">
                {a.titles.length} 本 · {a.titles.slice(0, 3).join(' / ')}{a.titles.length > 3 ? ` +${a.titles.length - 3}` : ''}
              </div>
            </div>
            <div class="text-right tabular-nums opacity-80">{toTimeString(a.readingTime)}</div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if summary.languages.length}
    <section class="my-6">
      <h3 class="text-lg mb-2">语言分布</h3>
      <div class="flex flex-col gap-2">
        {#each summary.languages as l (l.language)}
          <div class="flex items-center gap-3 text-sm">
            <div class="w-16 opacity-70">{l.language}</div>
            <div class="flex-1 h-3 rounded bg-gray-500/15 overflow-hidden">
              <div
                class="h-full bg-current/60 rounded"
                style="width:{(l.readingTime / languageMax) * 100}%;opacity:.6"
              ></div>
            </div>
            <div class="w-32 text-right tabular-nums opacity-80">
              {l.titles} 本 · {toTimeString(l.readingTime)}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if topSubjects.length}
    <section class="my-6">
      <h3 class="text-lg mb-2">分类云</h3>
      <div class="flex flex-wrap gap-2">
        {#each topSubjects as s (s.subject)}
          <span class="rounded-full border border-gray-500/40 px-3 py-1 text-sm">
            {s.subject} <span class="opacity-60 tabular-nums">{s.count}</span>
          </span>
        {/each}
      </div>
    </section>
  {/if}
{/if}
