<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintInOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import { faTrash, faPen } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';
  import type { Section } from '$lib/data/database/books-db/versions/books-db';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { normalizeHighlightSlot, slotSwatchStyle } from '$lib/data/highlight-color';
  import { highlightSlotStyles$ } from '$lib/data/store';
  import { t } from '$lib/i18n';

  export let highlights: BooksDbHighlight[] = [];
  export let sections: Section[] = [];

  const dispatch = createEventDispatcher<{
    navigate: BooksDbHighlight;
    editMemo: BooksDbHighlight;
    delete: BooksDbHighlight;
    close: void;
  }>();

  interface GroupedSection {
    label: string;
    items: BooksDbHighlight[];
  }

  $: grouped = groupBySection(highlights, sections, $t);

  function groupBySection(
    hls: BooksDbHighlight[],
    secs: Section[],
    tFn: (key: string, vars?: Record<string, string | number>) => string
  ): GroupedSection[] {
    if (!secs.length) {
      return hls.length ? [{ label: tFn('highlight.sidebar.all'), items: hls }] : [];
    }
    const groups: GroupedSection[] = [];
    const secStarts = secs.map((s) => s.startCharacter ?? 0);
    for (const hl of hls) {
      let secIdx = 0;
      for (let i = secStarts.length - 1; i >= 0; i--) {
        if (hl.startOffset >= secStarts[i]) {
          secIdx = i;
          break;
        }
      }
      const label = secs[secIdx]?.label || tFn('highlight.sidebar.section', { n: secIdx + 1 });
      if (!groups.length || groups[groups.length - 1].label !== label) {
        groups.push({ label, items: [] });
      }
      groups[groups.length - 1].items.push(hl);
    }
    return groups;
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  }
</script>

<div
  class="writing-horizontal-tb fixed top-0 left-0 z-[60] flex h-full w-full max-w-md flex-col"
  style="color:var(--font-color);background:var(--background-color);"
  in:fly|local={{ x: -100, duration: 100, easing: quintInOut }}
  use:clickOutside={() => dispatch('close')}
>
  <div class="flex items-center justify-between border-b border-current/10 px-4 py-3">
    <h2 class="text-lg font-medium">{$t('highlight.sidebar.title')}</h2>
    <span class="text-sm opacity-60">{$t('highlight.sidebar.count', { n: highlights.length })}</span>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-2">
    {#if !highlights.length}
      <p class="py-8 text-center text-sm opacity-50">{$t('highlight.sidebar.empty')}</p>
    {:else}
      {#each grouped as group (group.label)}
        <h3 class="sticky top-0 z-10 py-1.5 text-xs font-medium opacity-50" style="background:var(--background-color);">
          {group.label}
        </h3>
        {#each group.items as hl (hl.id)}
          <button
            type="button"
            class="mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover-soft"
            on:click={() => dispatch('navigate', hl)}
          >
            <div class="flex items-start gap-2">
              <span
                class="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                style={slotSwatchStyle($highlightSlotStyles$[normalizeHighlightSlot(hl.color)])}
              />
              <div class="min-w-0 flex-1">
                <p class="line-clamp-2 break-all">{hl.text}</p>
                {#if hl.memo}
                  <p class="mt-1 text-xs opacity-60 line-clamp-2 italic">📝 {hl.memo}</p>
                {/if}
                <div class="mt-1 flex items-center gap-2">
                  <span class="text-xs opacity-40">{formatTime(hl.createdAt)}</span>
                  <button
                    type="button"
                    class="text-xs opacity-40 hover:opacity-80"
                    title={$t('highlight.editMemo')}
                    on:click|stopPropagation={() => dispatch('editMemo', hl)}
                  ><Fa icon={faPen} size="xs" /></button>
                  <button
                    type="button"
                    class="text-xs opacity-40 hover:opacity-80 hover-danger"
                    title={$t('highlight.delete')}
                    on:click|stopPropagation={() => dispatch('delete', hl)}
                  ><Fa icon={faTrash} size="xs" /></button>
                </div>
              </div>
            </div>
          </button>
        {/each}
      {/each}
    {/if}
  </div>
</div>
