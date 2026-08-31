<script lang="ts">
  /**
   * The year view. Until now a year could only be seen by exporting the
   * markdown report — the richest data in the app was the data you had to
   * leave the app to read.
   *
   * Modules are switchable because "richer" and "more cluttered" are the same
   * change unless the reader gets to pick. The set of *hidden* ids is what's
   * persisted, so a module added in a later release shows up by default
   * instead of staying invisible until someone finds the toggle.
   */
  import { formatChars, formatDuration } from '$lib/components/statistics/statistics-format';
  import type { YearSummary } from '$lib/components/statistics/statistics-year/year-summary';
  import type { HighlightStatsSummary } from '$lib/functions/highlight-stats';
  import { yearModulesHidden$ } from '$lib/data/store';
  import { t } from '$lib/i18n';

  export let summary: YearSummary | null;
  export let highlights: HighlightStatsSummary | null = null;
  export let years: number[];
  export let year: number;

  const modules = ['overview', 'playback', 'structure', 'habits', 'notes', 'books'] as const;

  function toggle(id: string) {
    const next = new Set($yearModulesHidden$);
    if (!next.delete(id)) next.add(id);
    yearModulesHidden$.next(next);
  }

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  /**
   * Bar height in rem. Percentage heights are useless here: the columns sit in
   * an `items-end` row, so each one is only as tall as its content and a `%`
   * resolves against nothing. Measured — every bar came out invisible.
   */
  const bar = (value: number, max: number, rem: number) =>
    `${((Math.max(0, value) / max) * rem).toFixed(2)}rem`;

  // Manual reading is the remainder rather than a recorded number: rows
  // written before the playback split have no per-engine seconds at all.
  $: manualSeconds = summary
    ? Math.max(0, summary.totalSeconds - summary.ttsSeconds - summary.typewriterSeconds)
    : 0;
  $: maxMonth = summary ? Math.max(1, ...summary.monthly.map((m) => m.seconds)) : 1;
  $: maxHour = summary?.sessionStats ? Math.max(1, ...summary.sessionStats.hourHistogram) : 1;
  $: shown = (id: string) => !$yearModulesHidden$.has(id);
</script>

<div class="my-4 flex flex-wrap items-center gap-2">
  {#each years as y (y)}
    <button
      type="button"
      class="rounded border border-current/30 px-3 py-1 text-sm"
      class:bg-soft-active={y === year}
      on:click={() => (year = y)}>{y}</button
    >
  {/each}
  <div class="grow"></div>
  {#each modules as id (id)}
    <button
      type="button"
      class="rounded border border-current/30 px-2 py-0.5 text-xs"
      class:opacity-40={!shown(id)}
      title={$t('stats.year.toggleHint')}
      on:click={() => toggle(id)}>{$t(`stats.year.module.${id}`)}</button
    >
  {/each}
</div>

{#if !summary || !summary.totalSeconds}
  <div class="mt-16 text-center text-sm opacity-60">{$t('stats.year.empty')}</div>
{:else}
  {#if shown('overview')}
    <div class="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div class="rounded border border-current/30 p-3">
        <div class="text-xs opacity-70">{$t('stats.summary.totalTime')}</div>
        <div class="text-xl font-medium tabular-nums">{formatDuration(summary.totalSeconds)}</div>
      </div>
      <div class="rounded border border-current/30 p-3">
        <div class="text-xs opacity-70">
          {summary.totalPages
            ? $t('stats.summary.totalCharsAndPages')
            : $t('stats.summary.totalChars')}
        </div>
        <div class="text-xl font-medium tabular-nums">
          {formatChars(summary.totalChars)}{summary.totalPages
            ? ` / ${$t('stats.summary.pagesValue', { n: summary.totalPages })}`
            : ''}
        </div>
      </div>
      <div class="rounded border border-current/30 p-3">
        <div class="text-xs opacity-70">{$t('stats.summary.readDays')}</div>
        <div class="text-xl font-medium tabular-nums">{summary.activeDays}</div>
      </div>
      <div class="rounded border border-current/30 p-3">
        <div class="text-xs opacity-70">{$t('stats.summary.completedBooks')}</div>
        <div class="text-xl font-medium tabular-nums">{summary.completedBooks}</div>
      </div>
    </div>

    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.monthly')}</div>
      <div class="flex items-end gap-1">
        {#each summary.monthly as m (m.month)}
          <div
            class="flex flex-1 flex-col items-center justify-end gap-1"
            title="{m.month} · {formatDuration(m.seconds)}"
          >
            <div
              class="w-full rounded-t bg-current/40"
              style="height: {bar(m.seconds, maxMonth, 6)}"
            ></div>
            <div class="text-[10px] opacity-60">{m.month}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if shown('playback')}
    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.module.playback')}</div>
      {#if summary.ttsSeconds || summary.typewriterSeconds}
        <div class="flex h-3 w-full overflow-hidden rounded bg-current/10">
          <div
            class="bg-current/70"
            style="width: {pct(summary.ttsSeconds, summary.totalSeconds)}%"
          ></div>
          <div
            class="bg-current/40"
            style="width: {pct(summary.typewriterSeconds, summary.totalSeconds)}%"
          ></div>
        </div>
        <div class="mt-2 grid gap-1 text-xs sm:grid-cols-3">
          <div>
            {$t('stats.year.tts')} · {formatDuration(summary.ttsSeconds)}
            <span class="opacity-60"
              >{pct(summary.ttsSeconds, summary.totalSeconds)}% · {formatChars(
                summary.ttsCharacters
              )}</span
            >
          </div>
          <div>
            {$t('stats.year.typewriter')} · {formatDuration(summary.typewriterSeconds)}
            <span class="opacity-60"
              >{pct(summary.typewriterSeconds, summary.totalSeconds)}% · {formatChars(
                summary.typewriterCharacters
              )}</span
            >
          </div>
          <div>
            {$t('stats.year.manual')} · {formatDuration(manualSeconds)}
            <span class="opacity-60">{pct(manualSeconds, summary.totalSeconds)}%</span>
          </div>
        </div>
        <div class="mt-3 flex items-end gap-1">
          {#each summary.monthly as m (m.month)}
            <div class="flex flex-1 flex-col" title="{m.month} · {formatDuration(m.seconds)}">
              <div class="bg-current/70" style="height: {bar(m.ttsSeconds, maxMonth, 4)}"></div>
              <div
                class="bg-current/40"
                style="height: {bar(m.typewriterSeconds, maxMonth, 4)}"
              ></div>
              <div
                class="bg-current/15"
                style="height: {bar(m.seconds - m.ttsSeconds - m.typewriterSeconds, maxMonth, 4)}"
              ></div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="text-xs opacity-60">{$t('stats.year.noPlayback')}</div>
      {/if}
    </div>
  {/if}

  {#if shown('habits')}
    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.module.habits')}</div>
      {#if summary.sessionStats}
        <div class="flex items-end gap-[2px]">
          {#each summary.sessionStats.hourHistogram as sec, hour (hour)}
            <div
              class="flex-1 rounded-t bg-current/40"
              style="height: {bar(sec, maxHour, 4.5)}"
              title="{hour}:00 · {formatDuration(sec)}"
            ></div>
          {/each}
        </div>
        <div class="mt-1 flex justify-between text-[10px] opacity-50">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
        </div>
      {/if}
      <div class="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <div>
          {$t('stats.year.weekday')} · {formatDuration(summary.weekSplit.weekdaySeconds)}
          <span class="opacity-60"
            >{$t('stats.year.days', { n: summary.weekSplit.weekdayDays })}</span
          >
        </div>
        <div>
          {$t('stats.year.weekend')} · {formatDuration(summary.weekSplit.weekendSeconds)}
          <span class="opacity-60"
            >{$t('stats.year.days', { n: summary.weekSplit.weekendDays })}</span
          >
        </div>
      </div>
      {#if summary.sessionBuckets}
        {@const buckets = summary.sessionBuckets}
        <div class="mt-3 text-xs opacity-70">{$t('stats.year.sessionLengths')}</div>
        <div class="mt-1 flex flex-wrap gap-2 text-xs">
          {#each buckets.counts as count, i (i)}
            <div class="rounded border border-current/20 px-2 py-1">
              <span class="opacity-60"
                >{i === 0
                  ? $t('stats.year.bucketUnder', { max: buckets.edges[0] })
                  : i === buckets.counts.length - 1
                    ? $t('stats.year.bucketOver', { min: buckets.edges[buckets.edges.length - 1] })
                    : $t('stats.year.bucketRange', {
                        min: buckets.edges[i - 1],
                        max: buckets.edges[i]
                      })}</span
              >
              <span class="tabular-nums">{count}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if shown('structure')}
    {@const structure = summary.structure}
    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.module.structure')}</div>
      <div class="flex h-3 w-full overflow-hidden rounded bg-current/10">
        <div
          class="bg-current/70"
          style="width: {pct(structure.textSeconds, summary.totalSeconds)}%"
        ></div>
        <div
          class="bg-current/40"
          style="width: {pct(structure.imageSeconds, summary.totalSeconds)}%"
        ></div>
      </div>
      <div class="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <div>
          {$t('stats.year.textBooks')} · {formatDuration(structure.textSeconds)}
          <span class="opacity-60">{$t('stats.year.books', { n: structure.textBooks })}</span>
        </div>
        <div>
          {$t('stats.year.imageBooks')} · {formatDuration(structure.imageSeconds)}
          <span class="opacity-60">{$t('stats.year.books', { n: structure.imageBooks })}</span>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        {#each structure.byLanguage as entry (entry.language)}
          <div class="rounded border border-current/20 px-2 py-1">
            <!-- The code, not a translated name: a book can be in any
                 language and a lookup table would only cover the three the UI
                 itself speaks. -->
            <span class="opacity-60"
              >{entry.language ? entry.language.toUpperCase() : $t('stats.year.langUnknown')}</span
            >
            <span class="tabular-nums">{formatDuration(entry.seconds)}</span>
            <span class="tabular-nums opacity-60"
              >{$t('stats.year.books', { n: entry.books })}</span
            >
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if shown('notes')}
    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.module.notes')}</div>
      {#if highlights && (highlights.totalHighlights || highlights.totalNotes)}
        <div class="grid gap-1 text-xs sm:grid-cols-4">
          <div>
            {$t('stats.year.highlightCount')} ·
            <span class="tabular-nums">{highlights.totalHighlights}</span>
          </div>
          <div>
            {$t('stats.year.noteCount')} ·
            <span class="tabular-nums">{highlights.totalNotes}</span>
          </div>
          <div>
            {$t('stats.year.highlightChars')} ·
            <span class="tabular-nums">{formatChars(highlights.totalCharacters)}</span>
          </div>
          <div>
            {$t('stats.year.highlightDays')} ·
            <span class="tabular-nums">{highlights.daysWithHighlights}</span>
          </div>
        </div>
        <div class="mt-3 grid gap-1 text-xs">
          {#each highlights.byBook.slice(0, 5) as book (book.title)}
            <div class="grid items-center gap-2" style="grid-template-columns: 1fr 5rem 5rem;">
              <div class="truncate" title={book.title}>{book.title}</div>
              <div class="text-right tabular-nums">
                {$t('stats.year.highlightCount')}
                {book.highlights}
              </div>
              <div class="text-right tabular-nums opacity-70">
                {$t('stats.year.noteCount')}
                {book.notes}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="text-xs opacity-60">{$t('stats.year.noHighlights')}</div>
      {/if}
    </div>
  {/if}

  {#if shown('books')}
    <div class="my-4 rounded border border-current/30 p-3">
      <div class="mb-2 text-xs opacity-70">{$t('stats.year.module.books')}</div>
      <div class="grid gap-1 text-xs">
        {#each summary.topBooks as book, i (book.title)}
          <div class="grid items-center gap-2" style="grid-template-columns: 1.5rem 1fr 5rem 6rem;">
            <div class="tabular-nums opacity-50">{i + 1}</div>
            <div class="truncate" title={book.title}>{book.title}</div>
            <div class="text-right tabular-nums">{formatDuration(book.seconds)}</div>
            <div class="text-right tabular-nums opacity-70">
              {book.pages
                ? $t('stats.summary.pagesValue', { n: book.pages })
                : formatChars(book.chars)}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}
