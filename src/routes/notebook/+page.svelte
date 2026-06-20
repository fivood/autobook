<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import { faArrowLeft, faTrash, faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';
  import { database } from '$lib/data/store';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';

  const colorDot: Record<string, string> = {
    yellow: 'rgba(255,235,59,0.8)',
    blue: 'rgba(100,181,246,0.7)',
    green: 'rgba(129,199,132,0.7)',
    pink: 'rgba(244,143,177,0.7)'
  };

  let highlights: BooksDbHighlight[] = [];
  let titleToId = new Map<string, number>();
  let query = '';
  let loaded = false;

  $: filtered = filterHighlights(highlights, query);
  $: groups = groupByBook(filtered);

  onMount(async () => {
    if (!browser) return;
    const [all, books] = await Promise.all([
      database.getAllHighlights(),
      (async () => {
        const db = await database.db;
        return db.getAll('data');
      })()
    ]);
    titleToId = new Map(books.map((b) => [b.title, b.id]));
    highlights = all.sort((a, b) => b.lastModified - a.lastModified);
    loaded = true;
  });

  function filterHighlights(list: BooksDbHighlight[], q: string): BooksDbHighlight[] {
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (h) =>
        h.text.toLowerCase().includes(term) ||
        h.memo.toLowerCase().includes(term) ||
        h.bookTitle.toLowerCase().includes(term)
    );
  }

  function groupByBook(list: BooksDbHighlight[]): Array<{ title: string; items: BooksDbHighlight[] }> {
    const map = new Map<string, BooksDbHighlight[]>();
    for (const h of list) {
      const arr = map.get(h.bookTitle) || [];
      arr.push(h);
      map.set(h.bookTitle, arr);
    }
    return [...map.entries()]
      .map(([title, items]) => ({
        title,
        items: items.sort((a, b) => a.startOffset - b.startOffset)
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mm}-${dd} ${hh}:${mi}`;
  }

  function openHighlight(h: BooksDbHighlight) {
    const bookId = titleToId.get(h.bookTitle);
    if (!bookId) return;
    goto(`${pagePath}/b?id=${bookId}&hl=${h.id}`);
  }

  async function removeOne(h: BooksDbHighlight) {
    if (!confirm(`删除此高亮？\n\n${h.text.slice(0, 60)}${h.text.length > 60 ? '…' : ''}`)) return;
    await database.deleteHighlight(h.id);
    highlights = highlights.filter((x) => x.id !== h.id);
  }
</script>

<svelte:head>
  <title>{formatPageTitle('笔记本')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="sticky top-0 z-10 flex items-center gap-4 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <button
      type="button"
      class="rounded p-2 hover:bg-black/5"
      title="返回书库"
      on:click={() => goto(`${pagePath}${mergeEntries.MANAGE.routeId}`)}
    ><Fa icon={faArrowLeft} /></button>
    <h1 class="text-xl font-medium">笔记本</h1>
    <span class="text-sm opacity-50">{highlights.length} 条高亮 · {groups.length} 本书</span>
    <div class="flex-1" />
    <input
      type="search"
      placeholder="搜索原文、备注、书名"
      class="w-64 rounded border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/40"
      bind:value={query}
    />
  </header>

  <main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
    {#if !loaded}
      <p class="py-12 text-center opacity-50">加载中…</p>
    {:else if !highlights.length}
      <p class="py-12 text-center opacity-50">还没有高亮，打开书选中文字右键添加</p>
    {:else if !groups.length}
      <p class="py-12 text-center opacity-50">没有匹配的结果</p>
    {:else}
      {#each groups as group (group.title)}
        {@const bookExists = titleToId.has(group.title)}
        <section class="mb-8">
          <div class="mb-3 flex items-baseline gap-3 border-b border-current/10 pb-2">
            <h2 class="text-lg font-medium">{group.title}</h2>
            <span class="text-xs opacity-50">{group.items.length} 条</span>
            {#if !bookExists}
              <span class="rounded bg-current/10 px-2 py-0.5 text-xs opacity-70">书已删除</span>
            {/if}
          </div>
          <ul class="space-y-2">
            {#each group.items as h (h.id)}
              <li class="rounded-lg border border-current/10 p-3">
                <div class="flex items-start gap-3">
                  <span
                    class="mt-1.5 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                    style="background:{colorDot[h.color] || colorDot.yellow}"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{h.text}</p>
                    {#if h.memo}
                      <p class="mt-2 whitespace-pre-wrap break-words rounded bg-current/5 px-2 py-1.5 text-sm italic opacity-80">📝 {h.memo}</p>
                    {/if}
                    <div class="mt-2 flex items-center gap-3 text-xs opacity-50">
                      <span>{formatTime(h.createdAt)}</span>
                      {#if bookExists}
                        <button
                          type="button"
                          class="flex items-center gap-1 hover:opacity-100"
                          on:click={() => openHighlight(h)}
                        ><Fa icon={faExternalLinkAlt} size="xs" /> 跳转</button>
                      {/if}
                      <button
                        type="button"
                        class="flex items-center gap-1 hover:text-red-500 hover:opacity-100"
                        on:click={() => removeOne(h)}
                      ><Fa icon={faTrash} size="xs" /> 删除</button>
                    </div>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </main>
</div>
