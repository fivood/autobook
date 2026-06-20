<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

  export let source: BooksDbHighlight;
  export let candidates: BooksDbHighlight[] = [];

  const dispatch = createEventDispatcher<{ pick: number; cancel: void }>();

  let query = '';

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
    <h3 class="mb-2 text-lg font-medium">链接到另一条</h3>
    <p class="mb-3 line-clamp-2 rounded bg-current/5 px-3 py-2 text-xs italic opacity-70">
      源：{preview(source).slice(0, 100)}
    </p>
    <input
      type="search"
      bind:value={query}
      placeholder="搜索原文 / 备注 / 书名"
      class="mb-2 w-full rounded border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/40"
      autofocus
    />
    <div class="flex-1 overflow-y-auto">
      {#if !filtered.length}
        <p class="py-6 text-center text-sm opacity-50">没有匹配项</p>
      {/if}
      {#each filtered as c (c.id)}
        <button
          type="button"
          class="mb-1 w-full rounded px-3 py-2 text-left text-sm hover:bg-black/5"
          on:click={() => dispatch('pick', c.id)}
        >
          <p class="line-clamp-2 break-all">{preview(c)}</p>
          <p class="mt-0.5 text-xs opacity-50">{c.bookTitle || '独立笔记'}</p>
        </button>
      {/each}
    </div>
    <div class="mt-3 flex justify-end">
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm opacity-70 hover:opacity-100"
        on:click={() => dispatch('cancel')}
      >取消</button>
    </div>
  </div>
</div>
