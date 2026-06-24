<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import {
    faTrash,
    faExternalLinkAlt,
    faPlus,
    faDownload,
    faPen,
    faLink,
    faUnlink,
    faShuffle,
    faFolder
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import type {
    BooksDbHighlight,
    BooksDbHighlightFolder
  } from '$lib/data/database/books-db/versions/books-db';
  import { database } from '$lib/data/store';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import HighlightMemoDialog from '$lib/components/book-reader/book-highlight/highlight-memo-dialog.svelte';
  import NotebookFolderSidebar from '$lib/components/notebook/notebook-folder-sidebar.svelte';
  import NotebookLinkPicker from '$lib/components/notebook/notebook-link-picker.svelte';
  import NotebookReviewModal from '$lib/components/notebook/notebook-review-modal.svelte';
  import { isTauri } from '$lib/data/env';
  import { obsidianVaultPath$ } from '$lib/data/store';
  import { buildSyncPlan } from '$lib/functions/notebook/obsidian-sync';

  const STANDALONE_TITLE = '__standalone__';
  const REVIEW_BATCH = 10;
  const FRESH_REVIEW_MS = 1000 * 60 * 60 * 24 * 7; // less than 7d since reviewed = down-weight

  const colorDot: Record<string, string> = {
    yellow: 'rgba(255,235,59,0.8)',
    blue: 'rgba(100,181,246,0.7)',
    green: 'rgba(129,199,132,0.7)',
    pink: 'rgba(244,143,177,0.7)'
  };

  let highlights: BooksDbHighlight[] = [];
  let folders: BooksDbHighlightFolder[] = [];
  let titleToId = new Map<string, number>();
  let query = '';
  let selectedTags = new Set<string>();
  let selectedView = 'all'; // 'all' | 'unfiled' | 'standalone' | 'folder:<id>'
  let loaded = false;

  let editTarget: BooksDbHighlight | undefined;
  let createMode = false;
  let dialogOpen = false;
  let dialogMemo = '';
  let dialogText = '';
  let dialogTags: string[] = [];

  let linkPickerSource: BooksDbHighlight | undefined;
  let reviewQueue: BooksDbHighlight[] = [];
  let reviewOpen = false;
  let syncing = false;
  let syncMessage = '';

  let prevPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;

  afterNavigate((navigation) => {
    const { from } = navigation;
    if (!from) return;
    prevPage = `${from.url.pathname}${from.url.search}`;
  });

  $: highlightById = new Map(highlights.map((h) => [h.id, h]));
  $: folderIdSet = new Set(folders.map((f) => f.id));
  $: viewFiltered = applyView(highlights, selectedView);
  $: filtered = filterHighlights(viewFiltered, query, selectedTags);
  $: groups = groupByBook(filtered);
  $: allTags = collectTags(viewFiltered);
  $: counts = computeCounts(highlights);

  onMount(async () => {
    if (!browser) return;
    await refresh();
    loaded = true;
  });

  async function refresh() {
    const [all, folderList, books] = await Promise.all([
      database.getAllHighlights(),
      database.getHighlightFolders(),
      (async () => {
        const db = await database.db;
        return db.getAll('data');
      })()
    ]);
    titleToId = new Map(books.map((b) => [b.title, b.id]));
    highlights = all.sort((a, b) => b.lastModified - a.lastModified);
    folders = folderList;
  }

  function effectiveFolderId(h: BooksDbHighlight): number | undefined {
    return h.folderId !== undefined && folderIdSet.has(h.folderId) ? h.folderId : undefined;
  }

  function computeCounts(list: BooksDbHighlight[]): Record<string, number> {
    const result: Record<string, number> = {
      all: list.length,
      unfiled: 0,
      standalone: 0
    };
    for (const h of list) {
      if (h.kind === 'note') result.standalone += 1;
      const fid = effectiveFolderId(h);
      if (fid === undefined) result.unfiled += 1;
      else result[`folder:${fid}`] = (result[`folder:${fid}`] || 0) + 1;
    }
    return result;
  }

  function applyView(list: BooksDbHighlight[], view: string): BooksDbHighlight[] {
    if (view === 'all') return list;
    if (view === 'unfiled') return list.filter((h) => effectiveFolderId(h) === undefined);
    if (view === 'standalone') return list.filter((h) => h.kind === 'note');
    if (view.startsWith('folder:')) {
      const id = Number(view.slice('folder:'.length));
      return list.filter((h) => effectiveFolderId(h) === id);
    }
    return list;
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
    const out = [...map.entries()].map(([title, items]) => ({
      title,
      items:
        title === STANDALONE_TITLE
          ? items.sort((a, b) => b.lastModified - a.lastModified)
          : items.sort((a, b) => a.startOffset - b.startOffset)
    }));
    out.sort((a, b) => {
      if (a.title === STANDALONE_TITLE) return -1;
      if (b.title === STANDALONE_TITLE) return 1;
      return a.title.localeCompare(b.title);
    });
    return out;
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
      const folderId =
        selectedView.startsWith('folder:') ? Number(selectedView.slice(7)) : undefined;
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
        ...(tags.length ? { tags } : {}),
        ...(folderId !== undefined ? { folderId } : {})
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

  async function moveToFolder(h: BooksDbHighlight, folderId: number | undefined) {
    await database.setHighlightFolder(h.id, folderId);
    highlights = highlights.map((x) =>
      x.id === h.id ? { ...x, folderId, lastModified: Date.now() } : x
    );
  }

  function handleFolderChange(h: BooksDbHighlight, ev: Event) {
    const v = (ev.currentTarget as HTMLSelectElement).value;
    moveToFolder(h, v ? Number(v) : undefined);
  }

  async function handleCreateFolder(name: string) {
    const id = await database.addHighlightFolder(name);
    folders = await database.getHighlightFolders();
    selectedView = `folder:${id}`;
  }

  async function handleRenameFolder(id: number, name: string) {
    await database.renameHighlightFolder(id, name);
    folders = await database.getHighlightFolders();
  }

  async function handleDeleteFolder(id: number) {
    await database.deleteHighlightFolder(id);
    folders = await database.getHighlightFolders();
    highlights = highlights.map((h) =>
      h.folderId === id ? { ...h, folderId: undefined, lastModified: Date.now() } : h
    );
    if (selectedView === `folder:${id}`) selectedView = 'all';
  }

  async function pickLinkTarget(targetId: number) {
    if (!linkPickerSource) return;
    await database.linkHighlights(linkPickerSource.id, targetId);
    linkPickerSource = undefined;
    await refresh();
  }

  async function unlinkOne(h: BooksDbHighlight, otherId: number) {
    await database.unlinkHighlights(h.id, otherId);
    await refresh();
  }

  function openReview() {
    const now = Date.now();
    const pool = highlights
      .map((h) => {
        const since = h.lastReviewedAt ? now - h.lastReviewedAt : now - h.createdAt;
        const weight = Math.max(1, since / FRESH_REVIEW_MS);
        return { h, weight: weight * Math.random() };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, REVIEW_BATCH)
      .map(({ h }) => h);
    reviewQueue = pool;
    reviewOpen = pool.length > 0;
    if (!pool.length) alert('暂无可回顾的内容');
  }

  async function pickVaultFolder() {
    if (!isTauri()) {
      alert('文件夹选择只在桌面端可用');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: '选择 Obsidian vault 目录' });
    if (typeof picked === 'string') {
      obsidianVaultPath$.next(picked);
    }
  }

  async function syncToVault() {
    if (!isTauri()) {
      alert('vault 同步只在桌面端可用');
      return;
    }
    const vault = $obsidianVaultPath$;
    if (!vault) {
      alert('请先选择 Obsidian vault 目录');
      return;
    }
    syncing = true;
    syncMessage = '';
    try {
      const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
      const plan = buildSyncPlan(highlights, folderNameById);
      const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
      const rootPath = `${vault}/${plan.rootDirName}`;
      if (!(await exists(rootPath))) {
        await mkdir(rootPath, { recursive: true });
      }
      const dirsCreated = new Set<string>();
      for (const f of plan.files) {
        const fullPath = `${rootPath}/${f.relativePath}`;
        const dirPath = fullPath.slice(0, fullPath.lastIndexOf('/'));
        if (!dirsCreated.has(dirPath)) {
          if (!(await exists(dirPath))) {
            await mkdir(dirPath, { recursive: true });
          }
          dirsCreated.add(dirPath);
        }
        await writeTextFile(fullPath, f.content);
      }
      syncMessage = `已同步 ${plan.files.length} 条到 ${plan.rootDirName}/`;
    } catch (err: any) {
      syncMessage = `同步失败：${err?.message || err}`;
    } finally {
      syncing = false;
    }
  }

  async function handleReviewMark(id: number) {
    await database.markHighlightReviewed(id);
    const now = Date.now();
    highlights = highlights.map((h) =>
      h.id === id ? { ...h, lastReviewedAt: now, lastModified: now } : h
    );
  }

  function exportMarkdown() {
    const lines: string[] = [];
    lines.push(`# 笔记本导出`);
    lines.push('');
    lines.push(`> 共 ${filtered.length} 条 · ${formatTime(Date.now())}`);
    if (query.trim()) lines.push(`> 搜索：${query.trim()}`);
    if (selectedTags.size) lines.push(`> 标签：${[...selectedTags].map((t) => `#${t}`).join(' ')}`);
    if (selectedView !== 'all') {
      const label =
        selectedView === 'unfiled'
          ? '未归档'
          : selectedView === 'standalone'
            ? '独立笔记'
            : folders.find((f) => `folder:${f.id}` === selectedView)?.name || selectedView;
      lines.push(`> 视图：${label}`);
    }
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

  function getLinked(h: BooksDbHighlight): BooksDbHighlight[] {
    return (h.linkedIds || [])
      .map((id) => highlightById.get(id))
      .filter((x): x is BooksDbHighlight => !!x);
  }
</script>

<svelte:head>
  <title>{formatPageTitle('笔记本')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <h1 class="text-xl font-medium">笔记本</h1>
    <span class="text-sm opacity-50">{filtered.length}/{highlights.length}</span>
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
      title="今日回顾：随机选 10 条久未回看的内容"
      on:click={openReview}
    ><Fa icon={faShuffle} size="xs" /> 回顾</button>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
      on:click={openCreateNote}
    ><Fa icon={faPlus} size="xs" /> 新建笔记</button>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
      on:click={exportMarkdown}
      disabled={!filtered.length}
    ><Fa icon={faDownload} size="xs" /> 导出 .md</button>
    {#if isTauri()}
      {#if $obsidianVaultPath$}
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
          on:click={syncToVault}
          disabled={syncing || !highlights.length}
          title="vault: {$obsidianVaultPath$}"
        ><Fa icon={faDownload} size="xs" /> {syncing ? '同步中…' : '同步到 vault'}</button>
        <button
          type="button"
          class="text-xs opacity-50 hover:opacity-100"
          title="vault: {$obsidianVaultPath$}"
          on:click={pickVaultFolder}
        >更换</button>
      {:else}
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover:bg-black/5"
          on:click={pickVaultFolder}
        ><Fa icon={faFolder} size="xs" /> 选择 vault</button>
      {/if}
    {/if}
    <MergedHeaderIcon leavePageLink={prevPage} />
  </header>

  {#if syncMessage}
    <div class="border-b border-current/10 px-4 py-2 text-xs opacity-70">{syncMessage}</div>
  {/if}

  {#if allTags.length}
    <div class="flex flex-wrap items-center gap-2 border-b border-current/10 px-4 py-2 text-xs">
      <span class="opacity-50">标签：</span>
      {#each allTags as tag (tag)}
        <button
          type="button"
          class="rounded-full border px-2 py-0.5 transition-colors"
          style:border-color={selectedTags.has(tag) ? 'transparent' : 'currentColor'}
          style:background={selectedTags.has(tag) ? 'currentColor' : 'transparent'}
          style:color={selectedTags.has(tag) ? 'var(--background-color)' : 'inherit'}
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

  <div class="flex flex-1">
    <NotebookFolderSidebar
      {folders}
      {counts}
      selectedKey={selectedView}
      on:select={({ detail }) => (selectedView = detail)}
      on:create={({ detail }) => handleCreateFolder(detail)}
      on:rename={({ detail }) => handleRenameFolder(detail.id, detail.name)}
      on:delete={({ detail }) => handleDeleteFolder(detail)}
    />

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
                      {#if getLinked(h).length}
                        <div class="mt-2 space-y-1 rounded border border-current/10 bg-current/5 p-2">
                          <p class="text-xs opacity-50">关联 {getLinked(h).length} 条</p>
                          {#each getLinked(h) as lnk (lnk.id)}
                            <div class="flex items-start gap-2 text-xs">
                              <Fa icon={faLink} size="xs" class="mt-1 opacity-50" />
                              <p class="line-clamp-1 flex-1 break-all opacity-80">
                                {(lnk.kind === 'note' ? lnk.memo : lnk.text).slice(0, 80)}
                                <span class="opacity-50">— {lnk.bookTitle || '独立笔记'}</span>
                              </p>
                              <button
                                type="button"
                                class="opacity-50 hover:text-red-500 hover:opacity-100"
                                title="解除链接"
                                on:click={() => unlinkOne(h, lnk.id)}
                              ><Fa icon={faUnlink} size="xs" /></button>
                            </div>
                          {/each}
                        </div>
                      {/if}
                      <div class="mt-2 flex flex-wrap items-center gap-3 text-xs opacity-50">
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
                          class="flex items-center gap-1 hover:opacity-100"
                          on:click={() => (linkPickerSource = h)}
                        ><Fa icon={faLink} size="xs" /> 链接</button>
                        <label class="flex items-center gap-1">
                          <Fa icon={faFolder} size="xs" />
                          <select
                            class="bg-transparent text-xs opacity-100"
                            style="color:var(--font-color);"
                            value={h.folderId ?? ''}
                            on:change={(ev) => handleFolderChange(h, ev)}
                          >
                            <option value="" style="color:#000;">未归档</option>
                            {#each folders as f (f.id)}
                              <option value={f.id} style="color:#000;">{f.name}</option>
                            {/each}
                          </select>
                        </label>
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

{#if linkPickerSource}
  <NotebookLinkPicker
    source={linkPickerSource}
    candidates={highlights}
    on:pick={({ detail }) => pickLinkTarget(detail)}
    on:cancel={() => (linkPickerSource = undefined)}
  />
{/if}

{#if reviewOpen}
  <NotebookReviewModal
    queue={reviewQueue}
    on:markReviewed={({ detail }) => handleReviewMark(detail)}
    on:close={() => (reviewOpen = false)}
  />
{/if}
