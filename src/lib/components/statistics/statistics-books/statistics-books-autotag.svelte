<script lang="ts">
  /**
   * Auto-tagging panel above the books table.
   *
   * Deliberately two-speed. The baseline (normalising the imported subject
   * block) needs no model and no network, so the panel has something to show
   * the moment the tab opens — on a machine that will never run a model this
   * is the whole feature, not a teaser for one. The model button only appears
   * when a runtime is actually there, following the same "probe, don't
   * promote" rule as the rest of the AI surface.
   *
   * Nothing is written until the reader ticks rows and applies: the target is
   * `manualBook.tags`, the user-entered store.
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type {
    BooksDbBookMetadata,
    BooksDbManualBook
  } from '$lib/data/database/books-db/versions/books-db';
  import {
    abortAutoTagJob,
    applyAutoTags,
    autoTagJob$,
    clearAutoTagJob,
    computeBaselineSuggestions,
    selectBooksNeedingModel,
    startAutoTagJob,
    type AutoTagInput,
    type AutoTagSuggestion
  } from '$lib/data/ai/auto-tag-job';
  import { resolveEndpoint, type ResolvedEndpoint } from '$lib/data/ai/endpoint';
  import { probeLocalModels } from '$lib/data/ai/local-model';
  import { buttonClasses } from '$lib/css-classes';
  import { t } from '$lib/i18n';

  export let manualBooks: BooksDbManualBook[] = [];
  export let bookMetadata: BooksDbBookMetadata[] = [];
  /** Titles currently listed in the books tab — the period scope applies. */
  export let titles: string[] = [];

  const dispatch = createEventDispatcher<{ applied: { booksUpdated: number } }>();

  let endpoint: ResolvedEndpoint | undefined;
  let expanded = false;
  let applying = false;
  let appliedNote = '';
  let error = '';
  let selected = new Set<string>();
  let selectionKey = '';

  onMount(() => {
    // 7B floor. Unlike glossing or OCR correction, tagging a book the file
    // said nothing about runs on world knowledge alone, and a small model
    // answers confidently and wrongly instead of returning the empty array
    // the prompt asks for. Below this the suggestions cost more to review
    // than they save.
    probeLocalModels()
      .then(() => (endpoint = resolveEndpoint('prefer-local', 7)))
      .catch(() => {
        // No runtime simply leaves `endpoint` undefined and hides the button.
      });
  });

  onDestroy(() => {
    if ($autoTagJob$?.status !== 'running') clearAutoTagJob();
  });

  $: manualByTitle = new Map(manualBooks.map((m) => [m.title, m]));
  $: metaByTitle = new Map(bookMetadata.map((m) => [m.title, m]));

  $: inputs = titles.map((title): AutoTagInput => {
    const meta = metaByTitle.get(title);
    return {
      title,
      author: manualByTitle.get(title)?.author || meta?.author,
      publisher: manualByTitle.get(title)?.publisher || meta?.publisher,
      language: meta?.language,
      subjects: meta?.subjects,
      existingTags: manualByTitle.get(title)?.tags
    };
  });

  $: job = $autoTagJob$;
  $: baseline = computeBaselineSuggestions(inputs);
  // Once a run has happened its list wins — it contains the baseline rows too.
  $: suggestions = job ? job.suggestions : baseline;
  $: modelCandidates = selectBooksNeedingModel(inputs);
  $: running = job?.status === 'running';

  // Reset the ticks whenever the underlying list changes, defaulting to all
  // on: the rows are already filtered down to books with something to add.
  $: {
    const key = suggestions.map((s) => `${s.title}:${s.newTags.join(',')}`).join('|');
    if (key !== selectionKey) {
      selectionKey = key;
      selected = new Set(suggestions.map((s) => s.title));
    }
  }

  $: acceptedCount = suggestions.filter((s) => selected.has(s.title)).length;

  function toggle(title: string) {
    const next = new Set(selected);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    selected = next;
  }

  function toggleAll() {
    selected =
      selected.size === suggestions.length ? new Set() : new Set(suggestions.map((s) => s.title));
  }

  function runModel() {
    if (!endpoint) return;
    error = '';
    appliedNote = '';
    if (!startAutoTagJob(inputs, endpoint.opts)) {
      error = $t('stats.autotag.nothingForModel');
    }
  }

  async function apply() {
    if (applying || !acceptedCount) return;
    applying = true;
    error = '';
    try {
      const accepted = suggestions
        .filter((s) => selected.has(s.title))
        .map((s) => ({ title: s.title, tags: s.newTags }));
      const result = await applyAutoTags(accepted);
      appliedNote = $t('stats.autotag.applied', { n: result.booksUpdated });
      clearAutoTagJob();
      dispatch('applied', { booksUpdated: result.booksUpdated });
    } catch (err: any) {
      error = err?.message || String(err);
    } finally {
      applying = false;
    }
  }

  function sourceLabel(s: AutoTagSuggestion): string {
    if (s.baselineTags.length && s.modelTags.length) return $t('stats.autotag.sourceBoth');
    return s.modelTags.length ? $t('stats.autotag.sourceModel') : $t('stats.autotag.sourceFile');
  }
</script>

<div class="my-3 rounded border border-current/20 text-sm">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
    <button
      class="cursor-pointer hover-soft rounded px-1 -mx-1"
      on:click={() => (expanded = !expanded)}
    >
      <span class="opacity-60 mr-1">{expanded ? '▾' : '▸'}</span>{$t('stats.autotag.title')}
    </button>

    <span class="opacity-60 text-xs">
      {#if running}
        {$t('stats.autotag.running', {
          done: job?.progress.batch ?? 0,
          total: job?.progress.totalBatches ?? 0
        })}
      {:else if suggestions.length}
        {$t('stats.autotag.pending', { n: suggestions.length })}
      {:else}
        {$t('stats.autotag.none')}
      {/if}
    </span>

    <span class="flex-1"></span>

    {#if running}
      <button class={buttonClasses} on:click={abortAutoTagJob}>
        {$t('stats.autotag.stop')}
      </button>
    {:else if endpoint && modelCandidates.length}
      <button
        class={buttonClasses}
        title={$t('stats.autotag.runModelHint', {
          n: modelCandidates.length,
          model: endpoint.label
        })}
        on:click={runModel}
      >
        {$t('stats.autotag.runModel', { n: modelCandidates.length })}
      </button>
    {/if}
  </div>

  {#if job?.failedBatches}
    <div class="px-3 pb-1 text-xs opacity-60">
      {$t('stats.autotag.failedBatches', { n: job.failedBatches })}
    </div>
  {/if}
  {#if job?.error}
    <div class="px-3 pb-1 text-xs" style="color:var(--danger-color);">{job.error}</div>
  {/if}
  {#if error}
    <div class="px-3 pb-1 text-xs" style="color:var(--danger-color);">{error}</div>
  {/if}
  {#if appliedNote}
    <div class="px-3 pb-1 text-xs opacity-70">{appliedNote}</div>
  {/if}

  {#if expanded}
    {#if suggestions.length}
      <ul class="border-t border-current/20 max-h-72 overflow-y-auto">
        {#each suggestions as s (s.title)}
          <li class="flex items-start gap-2 px-3 py-1.5 border-b border-current/10 last:border-b-0">
            <input
              type="checkbox"
              class="mt-1 shrink-0"
              checked={selected.has(s.title)}
              on:change={() => toggle(s.title)}
            />
            <div class="min-w-0 flex-1">
              <div class="truncate" title={s.title}>{s.title}</div>
              <div class="flex flex-wrap items-center gap-1 mt-0.5">
                {#each s.newTags as tag (tag)}
                  <span class="text-[11px] px-1.5 py-0.5 rounded bg-current/10">{tag}</span>
                {/each}
                <span class="text-[10px] opacity-50 ml-1">{sourceLabel(s)}</span>
              </div>
              {#if s.existingTags.length}
                <div class="text-[10px] opacity-40 mt-0.5 truncate">
                  {$t('stats.autotag.existing', { tags: s.existingTags.join(' · ') })}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>

      <div class="flex items-center gap-2 px-3 py-2 border-t border-current/20">
        <button class="text-xs opacity-70 hover-soft rounded px-1.5 py-0.5" on:click={toggleAll}>
          {selected.size === suggestions.length
            ? $t('stats.autotag.selectNone')
            : $t('stats.autotag.selectAll')}
        </button>
        <span class="flex-1"></span>
        <button
          class="rounded px-3 py-1 text-xs disabled:opacity-40"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          disabled={applying || !acceptedCount}
          on:click={apply}
        >
          {$t('stats.autotag.apply', { n: acceptedCount })}
        </button>
      </div>
    {:else}
      <div class="border-t border-current/20 px-3 py-3 text-xs opacity-60">
        {$t('stats.autotag.emptyHint')}
      </div>
    {/if}
  {/if}
</div>
