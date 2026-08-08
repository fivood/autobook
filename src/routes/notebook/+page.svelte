<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
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
  import { onMount, onDestroy } from 'svelte';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import type {
    BooksDbHighlight,
    BooksDbHighlightFolder,
    HighlightColor
  } from '$lib/data/database/books-db/versions/books-db';
  import { database } from '$lib/data/store';
  import { dialogManager } from '$lib/data/dialog-manager';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import HighlightMemoDialog from '$lib/components/book-reader/book-highlight/highlight-memo-dialog.svelte';
  import NoteEditorDialog from '$lib/components/notebook/note-editor-dialog.svelte';
  import NotebookFolderSidebar from '$lib/components/notebook/notebook-folder-sidebar.svelte';
  import NotebookLinkPicker from '$lib/components/notebook/notebook-link-picker.svelte';
  import NotebookReviewModal from '$lib/components/notebook/notebook-review-modal.svelte';
  import { isTauri } from '$lib/data/env';
  import { t, tImmediate } from '$lib/i18n';
  import { obsidianVaultPath$ } from '$lib/data/store';
  import { buildSyncPlan } from '$lib/functions/notebook/obsidian-sync';
  import {
    STANDALONE_GROUP_TITLE,
    parseNotebookQuery,
    collectMatchTerms,
    collectTags,
    filterAndGroup,
    highlightHtml
  } from '$lib/functions/notebook/notebook-search';
  import type { NotebookSortKey, TagMode, NotebookGroup } from '$lib/functions/notebook/notebook-search';
  import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_DOT as colorDot } from '$lib/data/highlight-color';

  const REVIEW_BATCH = 10;
  const FRESH_REVIEW_MS = 1000 * 60 * 60 * 24 * 7; // less than 7d since reviewed = down-weight

  let highlights: BooksDbHighlight[] = [];
  let folders: BooksDbHighlightFolder[] = [];
  let titleToId = new Map<string, number>();
  let query = '';
  let debouncedQuery = '';
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  function onQueryInput() {
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      debouncedQuery = query;
    }, 90);
  }
  onDestroy(() => {
    if (queryTimer) clearTimeout(queryTimer);
  });
  let selectedTags = new Set<string>();
  let selectedView = 'all'; // 'all' | 'unfiled' | 'standalone' | 'folder:<id>'
  let loaded = false;
  let sortKey: NotebookSortKey = 'auto';
  let tagMode: TagMode = 'and';
  let selectedColors = new Set<HighlightColor>();

  let editTarget: BooksDbHighlight | undefined;
  let dialogOpen = false;
  let dialogMemo = '';
  let dialogText = '';
  let dialogTags: string[] = [];

  let noteEditorOpen = false;
  let noteEditorMode: 'create' | 'edit' = 'create';
  let noteEditorTarget: BooksDbHighlight | undefined;
  let noteEditorMemo = '';
  let noteEditorTags: string[] = [];
  let noteEditorColor: HighlightColor = 'yellow';

  let linkPickerSource: BooksDbHighlight | undefined;
  let reviewQueue: BooksDbHighlight[] = [];
  let reviewOpen = false;
  let syncing = false;
  let syncMessage = '';

  let prevPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;

  afterNavigate((navigation) => {
    const { from } = navigation;
    if (!from?.url) return;
    prevPage = `${from.url.pathname}${from.url.search}`;
  });

  $: highlightById = new Map(highlights.map((h) => [h.id, h]));
  $: folderIdSet = new Set(folders.map((f) => f.id));
  $: viewFiltered = applyView(highlights, selectedView);
  $: parsedQuery = parseNotebookQuery(debouncedQuery);
  $: effectiveQuery = {
    ...parsedQuery,
    colors: [...new Set([...parsedQuery.colors, ...selectedColors])]
  };
  $: matchTerms = collectMatchTerms(parsedQuery);
  $: filterResult = filterAndGroup(viewFiltered, effectiveQuery, selectedTags, tagMode, sortKey);
  $: filtered = filterResult.filtered;
  $: groups = filterResult.groups;
  $: allTags = collectTags(viewFiltered);
  $: counts = computeCounts(highlights);
  $: linkedById = buildLinkedById(groups, highlightById);

  onMount(async () => {
    if (!browser) return;
    // Pre-fill the search box from ?q=… so external links (e.g. the
    // manual-entry dialog's "在笔记本打开" button) can scope the notebook
    // to a specific book without the user retyping.
    const initialQuery = $page.url.searchParams.get('q');
    if (initialQuery) {
      query = initialQuery;
      debouncedQuery = initialQuery;
    }
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

  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    selectedTags = next;
  }

  function toggleColor(c: HighlightColor) {
    const next = new Set(selectedColors);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    selectedColors = next;
  }

  function setSort(ev: Event) {
    sortKey = (ev.currentTarget as HTMLSelectElement).value as NotebookSortKey;
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

  function removeOne(h: BooksDbHighlight) {
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: tImmediate('notebook.delete'),
          dialogMessage: tImmediate('notebook.deleteConfirm', {
            preview: (h.text || h.memo).slice(0, 60)
          }),
          contentStyles: 'white-space: pre-line;',
          resolver: async (wasCanceled: boolean) => {
            if (wasCanceled) return;
            await database.deleteHighlight(h.id);
            highlights = highlights.filter((x) => x.id !== h.id);
          }
        }
      }
    ]);
  }

  function openCreateNote() {
    noteEditorMode = 'create';
    noteEditorTarget = undefined;
    noteEditorMemo = '';
    noteEditorTags = [];
    noteEditorColor = 'yellow';
    noteEditorOpen = true;
  }

  function openEdit(h: BooksDbHighlight) {
    if (h.kind === 'note') {
      noteEditorMode = 'edit';
      noteEditorTarget = h;
      noteEditorMemo = h.memo;
      noteEditorTags = h.tags || [];
      noteEditorColor = h.color;
      noteEditorOpen = true;
    } else {
      editTarget = h;
      dialogText = h.text;
      dialogMemo = h.memo;
      dialogTags = h.tags || [];
      dialogOpen = true;
    }
  }

  async function handleDialogSave(detail: { memo: string; tags: string[] }) {
    const { memo, tags } = detail;
    if (editTarget) {
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
  }

  async function handleNoteEditorSave(detail: {
    memo: string;
    tags: string[];
    color: HighlightColor;
  }) {
    const { memo, tags, color } = detail;
    if (noteEditorMode === 'create') {
      if (!memo.trim()) {
        noteEditorOpen = false;
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
        color,
        createdAt: now,
        lastModified: now,
        kind: 'note',
        ...(tags.length ? { tags } : {}),
        ...(folderId !== undefined ? { folderId } : {})
      };
      const id = await database.addHighlight(note);
      highlights = [{ ...note, id } as BooksDbHighlight, ...highlights];
    } else if (noteEditorTarget) {
      const updated: BooksDbHighlight = {
        ...noteEditorTarget,
        memo,
        color,
        tags: tags.length ? tags : undefined,
        lastModified: Date.now()
      };
      await database.putHighlight(updated);
      highlights = highlights.map((h) => (h.id === updated.id ? updated : h));
    }
    noteEditorOpen = false;
    noteEditorTarget = undefined;
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
    if (!pool.length) alert(tImmediate('notebook.reviewEmpty'));
  }

  async function pickVaultFolder() {
    if (!isTauri()) {
      alert(tImmediate('notebook.desktopFolderOnly'));
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: tImmediate('notebook.pickVaultTitle') });
    if (typeof picked === 'string') {
      obsidianVaultPath$.next(picked);
    }
  }

  async function syncToVault() {
    if (!isTauri()) {
      alert(tImmediate('notebook.vaultDesktopOnly'));
      return;
    }
    const vault = $obsidianVaultPath$;
    if (!vault) {
      alert(tImmediate('notebook.pickVaultFirst'));
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
      syncMessage = tImmediate('notebook.syncDone', { n: plan.files.length, dir: plan.rootDirName });
    } catch (err: any) {
      syncMessage = tImmediate('notebook.syncFailed', { err: err?.message || err });
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
      lines.push(`## ${g.title === STANDALONE_GROUP_TITLE ? '独立笔记' : g.title}`);
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

  function buildLinkedById(
    groupsList: NotebookGroup[],
    byId: Map<number, BooksDbHighlight>
  ): Map<number, BooksDbHighlight[]> {
    const map = new Map<number, BooksDbHighlight[]>();
    for (const g of groupsList) {
      for (const h of g.items) {
        if (!h.linkedIds || !h.linkedIds.length) continue;
        const arr = h.linkedIds
          .map((id) => byId.get(id))
          .filter((x): x is BooksDbHighlight => !!x);
        if (arr.length) map.set(h.id, arr);
      }
    }
    return map;
  }
</script>

<svelte:head>
  <title>{formatPageTitle($t('notebook.title'))}</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <h1 class="text-xl font-medium">{$t('notebook.title')}</h1>
    <span class="text-sm opacity-50">{filtered.length}/{highlights.length}</span>
    <div class="flex-1" />
    <input
      type="search"
      placeholder={$t('notebook.search')}
      title={$t('notebook.search.syntaxHint')}
      class="w-64 rounded border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/40"
      bind:value={query}
      on:input={onQueryInput}
    />
    <select
      class="rounded border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none"
      style="color:var(--font-color);"
      value={sortKey}
      on:change={setSort}
      title={$t('notebook.sort.tooltip')}
    >
      <option value="auto" style="color:#000;">{$t('notebook.sort.auto')}</option>
      <option value="modified" style="color:#000;">{$t('notebook.sort.modified')}</option>
      <option value="created" style="color:#000;">{$t('notebook.sort.created')}</option>
      <option value="relevance" style="color:#000;">{$t('notebook.sort.relevance')}</option>
    </select>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover-soft"
      title={$t('notebook.review.tooltip')}
      on:click={openReview}
    ><Fa icon={faShuffle} size="xs" /> {$t('notebook.review.button')}</button>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover-soft"
      on:click={openCreateNote}
    ><Fa icon={faPlus} size="xs" /> {$t('notebook.new')}</button>
    <button
      type="button"
      class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover-soft"
      on:click={exportMarkdown}
      disabled={!filtered.length}
    ><Fa icon={faDownload} size="xs" /> {$t('notebook.exportMd')}</button>
    {#if isTauri()}
      {#if $obsidianVaultPath$}
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover-soft"
          on:click={syncToVault}
          disabled={syncing || !highlights.length}
          title="vault: {$obsidianVaultPath$}"
        ><Fa icon={faDownload} size="xs" /> {syncing ? $t('notebook.syncing') : $t('notebook.syncToVault')}</button>
        <button
          type="button"
          class="text-xs opacity-50 hover:opacity-100"
          title="vault: {$obsidianVaultPath$}"
          on:click={pickVaultFolder}
        >{$t('notebook.changeVault')}</button>
      {:else}
        <button
          type="button"
          class="flex items-center gap-1 rounded border border-current/20 px-3 py-1.5 text-sm hover-soft"
          on:click={pickVaultFolder}
        ><Fa icon={faFolder} size="xs" /> {$t('notebook.pickVault')}</button>
      {/if}
    {/if}
    <MergedHeaderIcon leavePageLink={prevPage} />
  </header>

  {#if syncMessage}
    <div class="border-b border-current/10 px-4 py-2 text-xs opacity-70">{syncMessage}</div>
  {/if}

  {#if highlights.length}
    <div class="flex flex-wrap items-center gap-2 border-b border-current/10 px-4 py-2 text-xs">
      <span class="opacity-50">{$t('notebook.colorLabel')}</span>
      {#each HIGHLIGHT_COLORS as c (c)}
        <button
          type="button"
          class="rounded-full border px-2 py-0.5 transition-colors"
          style:border-color={selectedColors.has(c) ? colorDot[c] : 'currentColor'}
          style:background={selectedColors.has(c) ? colorDot[c] : 'transparent'}
          style:opacity={selectedColors.has(c) ? 1 : 0.65}
          on:click={() => toggleColor(c)}
        ><span class="inline-block h-2 w-2 rounded-full align-middle" style="background:{colorDot[c]}" /></button>
      {/each}
      {#if selectedColors.size}
        <button
          type="button"
          class="opacity-50 hover:opacity-100"
          on:click={() => (selectedColors = new Set())}
        >{$t('notebook.clear')}</button>
      {/if}
      {#if allTags.length}
        <span class="ml-2 opacity-50">{$t('notebook.tagsLabel')}</span>
        <button
          type="button"
          class="rounded-full border border-current/20 px-2 py-0.5 opacity-65 hover:opacity-100"
          title={$t('notebook.tagMode.tooltip')}
          on:click={() => (tagMode = tagMode === 'and' ? 'or' : 'and')}
        >{tagMode === 'and' ? $t('notebook.tagMode.and') : $t('notebook.tagMode.or')}</button>
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
          >{$t('notebook.clear')}</button>
        {/if}
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
        <p class="py-12 text-center opacity-50">{$t('notebook.loading')}</p>
      {:else if !highlights.length}
        <p class="py-12 text-center opacity-50">{$t('notebook.emptyState')}</p>
      {:else if !groups.length}
        <p class="py-12 text-center opacity-50">{$t('notebook.noMatch')}</p>
      {:else}
        {#each groups as group (group.title)}
          {@const isStandalone = group.title === STANDALONE_GROUP_TITLE}
          {@const bookExists = !isStandalone && titleToId.has(group.title)}
          <section class="mb-8">
            <div class="mb-3 flex items-baseline gap-3 border-b border-current/10 pb-2">
              <h2 class="text-lg font-medium">{#if isStandalone}{$t('notebook.standalone')}{:else}{@html highlightHtml(group.title, matchTerms)}{/if}</h2>
              <span class="text-xs opacity-50">{$t('notebook.itemCount', { n: group.items.length })}</span>
              {#if !isStandalone && !bookExists}
                <span class="rounded bg-current/10 px-2 py-0.5 text-xs opacity-70">{$t('notebook.deletedBook')}</span>
              {/if}
            </div>
            <ul class="space-y-2">
              {#each group.items as h (h.id)}
                {@const linked = linkedById.get(h.id) ?? []}
                <li class="rounded-lg border border-current/10 p-3">
                  <div class="flex items-start gap-3">
                    <span
                      class="mt-1.5 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                      style="background:{colorDot[h.color] || colorDot.yellow}"
                    />
                    <div class="min-w-0 flex-1">
                      {#if h.kind === 'note'}
                        <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{@html highlightHtml(h.memo, matchTerms)}</p>
                      {:else}
                        <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{@html highlightHtml(h.text, matchTerms)}</p>
                        {#if h.memo}
                          <p class="mt-2 whitespace-pre-wrap break-words rounded bg-current/5 px-2 py-1.5 text-sm italic opacity-80">📝 {@html highlightHtml(h.memo, matchTerms)}</p>
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
                      {#if linked.length}
                        <div class="mt-2 space-y-1 rounded border border-current/10 bg-current/5 p-2">
                          <p class="text-xs opacity-50">{$t('notebook.linkedCount', { n: linked.length })}</p>
                          {#each linked as lnk (lnk.id)}
                            <div class="flex items-start gap-2 text-xs">
                              <Fa icon={faLink} size="xs" class="mt-1 opacity-50" />
                              <p class="line-clamp-1 flex-1 break-all opacity-80">
                                {(lnk.kind === 'note' ? lnk.memo : lnk.text).slice(0, 80)}
                                <span class="opacity-50">— {lnk.bookTitle || $t('notebook.standalone')}</span>
                              </p>
                              <button
                                type="button"
                                class="opacity-50 hover:text-red-500 hover:opacity-100"
                                title={$t('notebook.unlink')}
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
                          ><Fa icon={faExternalLinkAlt} size="xs" /> {$t('notebook.jump')}</button>
                        {/if}
                        <button
                          type="button"
                          class="flex items-center gap-1 hover:opacity-100"
                          on:click={() => openEdit(h)}
                        ><Fa icon={faPen} size="xs" /> {$t('notebook.edit')}</button>
                        <button
                          type="button"
                          class="flex items-center gap-1 hover:opacity-100"
                          on:click={() => (linkPickerSource = h)}
                        ><Fa icon={faLink} size="xs" /> {$t('notebook.link')}</button>
                        <label class="flex items-center gap-1">
                          <Fa icon={faFolder} size="xs" />
                          <select
                            class="bg-transparent text-xs opacity-100"
                            style="color:var(--font-color);"
                            value={h.folderId ?? ''}
                            on:change={(ev) => handleFolderChange(h, ev)}
                          >
                            <option value="" style="color:#000;">{$t('notebook.uncategorized')}</option>
                            {#each folders as f (f.id)}
                              <option value={f.id} style="color:#000;">{f.name}</option>
                            {/each}
                          </select>
                        </label>
                        <button
                          type="button"
                          class="flex items-center gap-1 hover:text-red-500 hover:opacity-100"
                          on:click={() => removeOne(h)}
                        ><Fa icon={faTrash} size="xs" /> {$t('notebook.delete')}</button>
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
    selectedText={dialogText}
    tags={dialogTags}
    on:save={({ detail }) => handleDialogSave(detail)}
    on:cancel={() => {
      dialogOpen = false;
      editTarget = undefined;
    }}
  />
{/if}

{#if noteEditorOpen}
  <NoteEditorDialog
    mode={noteEditorMode}
    memo={noteEditorMemo}
    tags={noteEditorTags}
    color={noteEditorColor}
    on:save={({ detail }) => handleNoteEditorSave(detail)}
    on:cancel={() => {
      noteEditorOpen = false;
      noteEditorTarget = undefined;
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

<style>
  :global(.nb-mark) {
    background: rgba(255, 213, 79, 0.55);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
