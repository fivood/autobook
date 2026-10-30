<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from '$lib/i18n';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

  export let source: BooksDbHighlight;
  export let candidates: BooksDbHighlight[] = [];

  const dispatch = createEventDispatcher<{ pick: number; cancel: void }>();

  let query = '';
  let inputEl: HTMLInputElement | undefined;

  tick().then(() => inputEl?.focus());

  $: filtered = candidates
    .filter((c) => c.id !== source.id && !(source.linkedIds || []).includes(c.id))
    .filter((c) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        c.text.toLowerCase().includes(q) ||
        c.memo.toLowerCase().includes(q) ||
        c.bookTitle.toLowerCase().includes(q)
      );
    })
    .slice(0, 30);

  function preview(h: BooksDbHighlight): string {
    if (h.kind === 'note') return h.memo;
    return h.text || h.memo;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40"
  on:click|self={() => dispatch('cancel')}
>
  <div
    class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg p-4 shadow-xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
  >
    <h3 class="mb-2 text-lg font-medium">{$t('notebook.linkPicker.title')}</h3>
    <p class="mb-3 line-clamp-2 rounded bg-current/5 px-3 py-2 text-xs italic opacity-70">
      {$t('notebook.linkPicker.source', { text: preview(source).slice(0, 100) })}
    </p>
    <input
      type="search"
      bind:value={query}
      bind:this={inputEl}
      placeholder={$t('notebook.linkPicker.search')}
      class="mb-2 w-full rounded border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/40"
      on:keydown={(ev) => {
        if (ev.key === 'Escape') dispatch('cancel');
        else if (ev.key === 'Enter' && filtered[0]) dispatch('pick', filtered[0].id);
      }}
    />
    <div class="flex-1 overflow-y-auto">
      {#if !filtered.length}
        <p class="py-6 text-center text-sm text-muted">{$t('notebook.linkPicker.noMatch')}</p>
      {/if}
      {#each filtered as c (c.id)}
        <button
          type="button"
          class="mb-1 w-full rounded px-3 py-2 text-left text-sm hover-soft"
          on:click={() => dispatch('pick', c.id)}
        >
          <p class="line-clamp-2 break-all">{preview(c)}</p>
          <p class="mt-0.5 text-xs text-muted">{c.bookTitle || $t('notebook.standalone')}</p>
        </button>
      {/each}
    </div>
    <div class="mt-3 flex justify-end">
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm opacity-70 hover:opacity-100"
        on:click={() => dispatch('cancel')}
      >{$t('dialog.cancel')}</button>
    </div>
  </div>
</div>
