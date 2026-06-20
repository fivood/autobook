<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faTrash,
    faExternalLinkAlt,
    faPlus,
    faDownload,
    faPen
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';
  import { database } from '$lib/data/store';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import HighlightMemoDialog from '$lib/components/book-reader/book-highlight/highlight-memo-dialog.svelte';

  const STANDALONE_TITLE = '__standalone__';

  const colorDot: Record<string, string> = {
    yellow: 'rgba(255,235,59,0.8)',
    blue: 'rgba(100,181,246,0.7)',
    green: 'rgba(129,199,132,0.7)',
    pink: 'rgba(244,143,177,0.7)'
  };

  let highlights: BooksDbHighlight[] = [];
  let titleToId = new Map<string, number>();
  let query = '';
  let selectedTags = new Set<string>();
  let loaded = false;

  let editTarget: BooksDbHighlight | undefined;
  let createMode = false;
  let dialogOpen = false;
  let dialogMemo = '';
  let dialogText = '';
  let dialogTags: string[] = [];

  $: filtered = filterHighlights(highlights, query, selectedTags);
  $: groups = groupByBook(filtered);
  $: allTags = collectTags(highlights);

  onMount(async () => {
    if (!browser) return;
    await refresh();
    loaded = true;
  });

  async function refresh() {
    const [all, books] = await Promise.all([
      database.getAllHighlights(),
      (async () => {
        const db = await database.db;
        return db.getAll('data');
      })()
    ]);
    titleToId = new Map(books.map((b) => [b.title, b.id]));
    highlights = all.sort((a, b) => b.lastModified - a.lastModified);
  }

  function collectTags(list: BooksDbHighlight[]): string[] {
    const counts = new Map<string, number>();
    for (const h of list) {
      for (const t of h.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }

  function filterHighlights(
    list: BooksDbHighlight[],
    q: string,
    tagSet: Set<string>
  ): BooksDbHighlight[] {
    const term = q.trim().toLowerCase();
    return list.filter((h) => {
      if (tagSet.size) {
        const hTags = h.tags || [];
        for (const t of tagSet) {
          if (!hTags.includes(t)) return false;
        }
      }
      if (!term) return true;
      return (
        h.text.toLowerCase().includes(term) ||
        h.memo.toLowerCase().includes(term) ||
        h.bookTitle.toLowerCase().includes(term) ||
        (h.tags || []).some((t) => t.toLowerCase().includes(term))
      );
    });
  }

  function groupByBook(list: BooksDbHighlight[]) {
    const map = new Map<string, BooksDbHighlight[]>();
    for (const h of list) {
      const key = h.kind === 'note' ? STANDALONE_TITLE : h.bookTitle;
      const arr = map.get(key) || [];
      arr.push(h);
      map.set(key, arr);
    }
    const groups = [...map.entries()].map(([title, items]) => ({
      title,
      items:
        title === STANDALONE_TITLE
          ? items.sort((a, b) => b.lastModified - a.lastModified)
          : items.sort((a, b) => a.startOffset - b.startOffset)
    }));
    groups.sort((a, b) => {
      if (a.title === STANDALONE_TITLE) return -1;
      if (b.title === STANDALONE_TITLE) return 1;
      return a.title.localeCompare(b.title);
    });
    return groups;
  }

  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    selectedTags = next;
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
    if (!confirm(`删除此条目？\n\n${(h.text || h.memo).slice(0, 60)}`)) return;
    await database.deleteHighlight(h.id);
    highlights = highlights.filter((x) => x.id !== h.id);
  }

  function openCreateNote() {
    createMode = true;
    editTarget = undefined;
    dialogText = '';
    dialogMemo = '';
    dialogTags = [];
    dialogOpen = true;
  }

  function openEdit(h: BooksDbHighlight) {
    createMode = false;
    editTarget = h;
    dialogText = h.text;
    dialogMemo = h.memo;
    dialogTags = h.tags || [];
    dialogOpen = true;
  }

  async function handleDialogSave(detail: { memo: string; tags: string[] }) {
    const { memo, tags } = detail;
    if (createMode) {
      if (!memo.trim()) {
        dialogOpen = false;
        return;
      }
      const now = Date.now();
      const note: Omit<BooksDbHighlight, 'id'> = {
        dataId: -1,
        bookTitle: '',
        startOffset: 0,
        endOffset: 0,
        text: '',
        memo,
        color: 'yellow',
        createdAt: now,
        lastModified: now,
        kind: 'note',
        ...(tags.length ? { tags } : {})
      };
      const id = await database.addHighlight(note);
      highlights = [{ ...note, id } as BooksDbHighlight, ...highlights];
    } else if (editTarget) {
      const updated: BooksDbHighlight = {
        ...editTarget,
        memo,
        tags: tags.length ? tags : undefined,
        lastModified: Date.now()
      };
      await database.putHighlight(updated);
      highlights = highlights.map((h) => (h.id === updated.id ? updated : h));
    }
    dialogOpen = false;
    editTarget = undefined;
    createMode = false;
  }

  function exportMarkdown() {
    const lines: string[] = [];
    lines.push(`# 笔记本导出`);
    lines.push('');
    lines.push(`> 共 ${filtered.length} 条 · ${formatTime(Date.now())}`);
    if (query.trim()) lines.push(`> 搜索：${query.trim()}`);
    if (selectedTags.size) lines.push(`> 标签：${[...selectedTags].map((t) => `#${t}`).join(' ')}`);
    lines.push('');
    for (const g of groups) {
      lines.push(`## ${g.title === STANDALONE_TITLE ? '独立笔记' : g.title}`);
      lines.push('');
      for (const h of g.items) {
        if (h.kind === 'note') {
          lines.push(h.memo);
        } else {
          for (const para of h.text.split(/\n+/)) {
            lines.push(`> ${para}`);
          }
          if (h.memo) {
            lines.push('');
            lines.push(`*备注：${h.memo}*`);
          }
        }
        const meta: string[] = [formatTime(h.createdAt)];
        if (h.tags && h.tags.length) meta.push(h.tags.map((t) => `#${t}`).join(' '));
        lines.push('');
        lines.push(`<sub>${meta.join(' · ')}</sub>`);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .replace(/\..+$/, '');
    a.href = url;
    a.download = `notebook-${stamp}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
</script>

<svelte:head>
  <title>{formatPageTitle('笔记本')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <button
      type="button"
      class="rounded p-2 hover:bg-black/5"
      title="返回书库"
      on:click={() => goto(`${pagePath}${mergeEntries.MANAGE.routeId}`)}
    ><Fa icon={faArrowLeft} /></button>
    <h1 class="text-xl font-medium">笔记本</h1>
    <span class="text-sm opacity-50">{filtered.length}/{highlights.length} · {groups.length} 组</span>
    <div class="flex-1" />
    <input
      type="search"
      placeholder="搜索原文、备注、书名、标签"
      class="w-64 rounded border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/40"
      bind:value={query}
    />
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
      title="新建独立笔记"
      on:click={openCreateNote}
    ><Fa icon={faPlus} size="xs" /> 新建笔记</button>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
      title="导出为 Markdown"
      on:click={exportMarkdown}
      disabled={!filtered.length}
    ><Fa icon={faDownload} size="xs" /> 导出 .md</button>
  </header>

  {#if allTags.length}
    <div class="flex flex-wrap items-center gap-2 border-b border-current/10 px-4 py-2 text-xs">
      <span class="opacity-50">标签：</span>
      {#each allTags as tag (tag)}
        <button
          type="button"
          class="rounded-full border px-2 py-0.5 transition-colors"
          class:bg-current={selectedTags.has(tag)}
          class:text-white={selectedTags.has(tag)}
          style:border-color={selectedTags.has(tag) ? 'transparent' : 'currentColor'}
          style:opacity={selectedTags.has(tag) ? 1 : 0.65}
          on:click={() => toggleTag(tag)}
        >#{tag}</button>
      {/each}
      {#if selectedTags.size}
        <button
          type="button"
          class="ml-2 opacity-50 hover:opacity-100"
          on:click={() => (selectedTags = new Set())}
        >清除</button>
      {/if}
    </div>
  {/if}

  <main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
    {#if !loaded}
      <p class="py-12 text-center opacity-50">加载中…</p>
    {:else if !highlights.length}
      <p class="py-12 text-center opacity-50">还没有内容。打开书右键添加高亮，或点上方「新建笔记」记录碎片心得</p>
    {:else if !groups.length}
      <p class="py-12 text-center opacity-50">没有匹配的结果</p>
    {:else}
      {#each groups as group (group.title)}
        {@const isStandalone = group.title === STANDALONE_TITLE}
        {@const bookExists = !isStandalone && titleToId.has(group.title)}
        <section class="mb-8">
          <div class="mb-3 flex items-baseline gap-3 border-b border-current/10 pb-2">
            <h2 class="text-lg font-medium">{isStandalone ? '独立笔记' : group.title}</h2>
            <span class="text-xs opacity-50">{group.items.length} 条</span>
            {#if !isStandalone && !bookExists}
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
                    {#if h.kind === 'note'}
                      <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{h.memo}</p>
                    {:else}
                      <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{h.text}</p>
                      {#if h.memo}
                        <p class="mt-2 whitespace-pre-wrap break-words rounded bg-current/5 px-2 py-1.5 text-sm italic opacity-80">📝 {h.memo}</p>
                      {/if}
                    {/if}
                    {#if h.tags && h.tags.length}
                      <div class="mt-2 flex flex-wrap gap-1">
                        {#each h.tags as t (t)}
                          <button
                            type="button"
                            class="rounded-full border border-current/20 px-2 py-0.5 text-xs opacity-70 hover:opacity-100"
                            on:click={() => toggleTag(t)}
                          >#{t}</button>
                        {/each}
                      </div>
                    {/if}
                    <div class="mt-2 flex items-center gap-3 text-xs opacity-50">
                      <span>{formatTime(h.createdAt)}</span>
                      {#if !isStandalone && bookExists}
                        <button
                          type="button"
                          class="flex items-center gap-1 hover:opacity-100"
                          on:click={() => openHighlight(h)}
                        ><Fa icon={faExternalLinkAlt} size="xs" /> 跳转</button>
                      {/if}
                      <button
                        type="button"
                        class="flex items-center gap-1 hover:opacity-100"
                        on:click={() => openEdit(h)}
                      ><Fa icon={faPen} size="xs" /> 编辑</button>
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

{#if dialogOpen}
  <HighlightMemoDialog
    memo={dialogMemo}
    selectedText={createMode ? '' : dialogText}
    tags={dialogTags}
    on:save={({ detail }) => handleDialogSave(detail)}
    on:cancel={() => {
      dialogOpen = false;
      editTarget = undefined;
      createMode = false;
    }}
  />
{/if}
