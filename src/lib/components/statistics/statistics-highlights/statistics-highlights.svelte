<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';
  import {
    aggregateHighlightStats,
    highlightSlots,
    type HighlightStatsSummary
  } from '$lib/functions/highlight-stats';
  import { database, highlightSlotStyles$, startDayHoursForTracker$ } from '$lib/data/store';
  import Fa from 'svelte-fa';
  import { t } from '$lib/i18n';
  import { onMount } from 'svelte';

  export let startDate: string;
  export let endDate: string;
  export let statisticsDateRangeLabel: string;
  export let titleFilter: Map<string, boolean>;

  let allHighlights: BooksDbHighlight[] = [];
  let isLoading = true;
  let summary: HighlightStatsSummary | undefined;

  onMount(async () => {
    try {
      allHighlights = await database.getAllHighlights();
    } finally {
      isLoading = false;
    }
  });

  $: if (!isLoading && startDate && endDate) {
    summary = aggregateHighlightStats(allHighlights, {
      startDate,
      endDate,
      startDayHoursForTracker: $startDayHoursForTracker$,
      titleFilter
    });
  }

  $: colorMax = summary
    ? Math.max(1, ...highlightSlots.map((c) => summary!.colorBreakdown[c]))
    : 1;

  $: topBooks = summary ? summary.byBook.slice(0, 10) : [];
  $: topTags = summary ? summary.byTag.slice(0, 20) : [];
  $: monthMax = summary ? Math.max(1, ...summary.byMonth.map((m) => m.count)) : 1;
</script>

{#if isLoading}
  <div class="flex items-center justify-center py-16 text-4xl">
    <Fa icon={faSpinner} spin />
  </div>
{:else if summary}
  <div class="my-4 text-muted">{$t('stats.hl.heading', { range: statisticsDateRangeLabel })}</div>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
    <div class="rounded border border-current/30 p-4">
      <div class="text-xs text-muted">{$t('stats.hl.highlights')}</div>
      <div class="text-2xl font-medium">{summary.totalHighlights}</div>
    </div>
    <div class="rounded border border-current/30 p-4">
      <div class="text-xs text-muted">{$t('stats.hl.notes')}</div>
      <div class="text-2xl font-medium">{summary.totalNotes}</div>
    </div>
    <div class="rounded border border-current/30 p-4">
      <div class="text-xs text-muted">{$t('stats.hl.chars')}</div>
      <div class="text-2xl font-medium">{summary.totalCharacters}</div>
    </div>
    <div class="rounded border border-current/30 p-4">
      <div class="text-xs text-muted">{$t('stats.hl.days')}</div>
      <div class="text-2xl font-medium">{summary.daysWithHighlights}</div>
    </div>
  </div>

  {#if summary.totalHighlights + summary.totalNotes === 0}
    <div class="text-muted text-center py-8">{$t('stats.hl.empty')}</div>
  {:else}
    <section class="my-6">
      <h3 class="text-lg mb-2">{$t('stats.hl.byColor')}</h3>
      <div class="flex flex-col gap-2">
        {#each highlightSlots as color (color)}
          {@const count = summary.colorBreakdown[color]}
          {@const pct = summary.totalHighlights
            ? Math.round((count / summary.totalHighlights) * 100)
            : 0}
          <div class="flex items-center gap-3 text-sm">
            <div class="w-14 text-muted">{$t('stats.hl.slot', { n: color })}</div>
            <div class="flex-1 h-3 rounded bg-current/15 overflow-hidden">
              <div
                class="h-full rounded"
                style="width:{(count / colorMax) * 100}%;background:rgb({$highlightSlotStyles$[color].rgb})"
              ></div>
            </div>
            <div class="w-24 text-right tabular-nums">{count} · {pct}%</div>
          </div>
        {/each}
      </div>
    </section>

    {#if summary.byMonth.length > 1}
      <section class="my-6">
        <h3 class="text-lg mb-2">{$t('stats.hl.byMonth')}</h3>
        <div class="flex items-end gap-1 h-24">
          {#each summary.byMonth as m (m.monthKey)}
            <div class="flex-1 flex flex-col items-center gap-1">
              <div
                class="w-full bg-current/60 rounded-t"
                style="height:{(m.count / monthMax) * 100}%;min-height:2px;opacity:.6"
                title="{m.monthKey}: {m.count}"
              ></div>
              <div class="text-[10px] opacity-60">{m.monthKey.slice(5)}</div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if topBooks.length}
      <section class="my-6">
        <h3 class="text-lg mb-2">{$t('stats.hl.topBooks')}</h3>
        <div class="flex flex-col gap-1">
          {#each topBooks as book, i (book.title)}
            <div class="grid grid-cols-[2rem_1fr_auto] gap-3 items-center text-sm py-1 border-b border-current/20">
              <div class="opacity-60 tabular-nums">#{i + 1}</div>
              <div class="truncate" title={book.title}>{book.title}</div>
              <div class="opacity-80 tabular-nums text-right">
                {$t('stats.hl.bookCount', { n: book.highlights })}{book.notes
                  ? $t('stats.hl.bookNotes', { n: book.notes })
                  : ''}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if topTags.length}
      <section class="my-6">
        <h3 class="text-lg mb-2">{$t('stats.hl.topTags')}</h3>
        <div class="flex flex-wrap gap-2">
          {#each topTags as tagRow (tagRow.tag)}
            <span class="rounded-full border border-current/40 px-3 py-1 text-sm">
              {tagRow.tag} <span class="text-muted tabular-nums">{tagRow.count}</span>
            </span>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
{/if}
