<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
  import type { ManualStatisticEntry } from '$lib/components/statistics/statistics-types';
  import { database } from '$lib/data/store';
  import type { BooksDbManualBook } from '$lib/data/database/books-db/versions/books-db';
  import { pagePath } from '$lib/data/env';
  import { goto } from '$app/navigation';
  import { createEventDispatcher, tick, onDestroy } from 'svelte';

  export let existingTitles: string[] = [];
  export let startDayHoursForTracker = 0;
  /** Called once, with the final entry when the user clicks 「添加」,
   * or with undefined when they cancel. Closes the dialog. */
  export let resolver: (value: ManualStatisticEntry | undefined) => void;
  /** Optional: called for each entry when the user clicks 「保存并继续」.
   * Dialog stays open, clears only the reading-entry numeric fields,
   * keeps title + metadata + date so repeat sessions of the same book
   * are one-click away. When null, the button is hidden. */
  export let onSaveAndContinue: ((value: ManualStatisticEntry) => Promise<void>) | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  const todayKey = getDateString(getStartHoursDate(startDayHoursForTracker));

  // ── Reading-entry fields ───────────────────────────────────────────
  let title = '';
  let dateKey = todayKey;
  let minutes: number | null = null;
  let characters: number | null = 0;
  let markCompleted = false;
  let conflictStrategy: 'append' | 'overwrite' = 'append';

  // ── Book-metadata fields (v11 manualBook table) ────────────────────
  let author = '';
  let translator = '';
  let publisher = '';
  let publishedYear: number | null = null;
  let isbn = '';
  let totalCharacters: number | null = null;
  let tagsInput = '';
  let bookNotes = '';
  let coverFile: File | null = null;
  let coverPreviewUrl: string | null = null;
  let existingCoverUrl: string | null = null;
  let clearCover = false;
  let loadedMeta: BooksDbManualBook | null = null;

  let showBookMeta = false;
  let error = '';
  let titleInputEl: HTMLInputElement | undefined;
  let minutesInputEl: HTMLInputElement | undefined;
  let noteCount = 0;
  let continuing = false;
  let savedCount = 0;
  // Progress % → derives charactersRead from totalCharacters. When user
  // types characters directly the slider un-links (progressPct set to
  // null so it doesn't overwrite). Common flow for physical books where
  // the reader knows "读到 30%" but not the exact character count.
  let progressPct: number | null = null;
  let charsFieldTouched = false;

  $: if (progressPct !== null && totalCharacters && !charsFieldTouched) {
    characters = Math.round((totalCharacters * progressPct) / 100);
  }

  $: trimmedTitle = title.trim();
  $: hasConflict = !!trimmedTitle && existingTitles.includes(`${trimmedTitle}__${dateKey}`);
  $: hasBookMeta =
    !!author ||
    !!translator ||
    !!publisher ||
    !!publishedYear ||
    !!isbn ||
    !!totalCharacters ||
    !!tagsInput.trim() ||
    !!bookNotes.trim() ||
    !!coverFile ||
    !!existingCoverUrl;

  tick().then(() => titleInputEl?.focus());

  // Load existing metadata whenever the title changes (debounce via
  // Svelte reactivity — no API rate limit needed, IDB lookup is µs).
  let lastLoadedTitle = '';
  $: if (trimmedTitle && trimmedTitle !== lastLoadedTitle) {
    lastLoadedTitle = trimmedTitle;
    loadExistingMeta(trimmedTitle);
  }

  async function loadExistingMeta(t: string) {
    try {
      const meta = await database.getManualBook(t);
      if (trimmedTitle !== t) return;
      if (meta) {
        loadedMeta = meta;
        author = meta.author ?? '';
        translator = meta.translator ?? '';
        publisher = meta.publisher ?? '';
        publishedYear = meta.publishedYear ?? null;
        isbn = meta.isbn ?? '';
        totalCharacters = meta.totalCharacters ?? null;
        tagsInput = (meta.tags ?? []).join(', ');
        bookNotes = meta.notes ?? '';
        if (existingCoverUrl) URL.revokeObjectURL(existingCoverUrl);
        existingCoverUrl = meta.coverBlob ? URL.createObjectURL(meta.coverBlob) : null;
        clearCover = false;
        if (author || publisher || meta.coverBlob) showBookMeta = true;
      } else {
        // No manualBook row yet — fall back to any imported book (EPUB/
        // MOBI) with the same title. `data.characters` gets populated
        // during import; use it as the totalCharacters default so the
        // progress-% slider works on first entry. Author fallback would
        // need a schema change (data table has no author field) — defer.
        const db = await database.db;
        const dataRows = await db.getAllFromIndex('data', 'title');
        if (trimmedTitle !== t) return;
        const dataMatch = dataRows.find((b) => b.title === t);
        if (dataMatch) {
          loadedMeta = null;
          if (dataMatch.characters && !totalCharacters) {
            totalCharacters = dataMatch.characters;
            showBookMeta = true;
          }
        }
      }
    } catch (e) {
      loadedMeta = null;
    }
    // Count highlights/notes for this title — for the "在笔记本打开"
    // link. Counts by `title` field on data (imported book) join;
    // orphan highlights (manual-only) also count by their standalone
    // title field. Cheap enough to run per title change.
    try {
      const highlights = await database.getAllHighlights();
      if (trimmedTitle !== t) return;
      noteCount = highlights.filter((h) => h.bookTitle === t).length;
    } catch {
      noteCount = 0;
    }
  }

  function onProgressPctInput(ev: Event) {
    const v = parseInt((ev.currentTarget as HTMLInputElement).value, 10);
    progressPct = Number.isFinite(v) ? v : null;
    charsFieldTouched = false;
  }

  function onTotalCharsInput(ev: Event) {
    const raw = (ev.currentTarget as HTMLInputElement).value;
    if (raw === '') {
      totalCharacters = null;
      return;
    }
    const v = parseFloat(raw);
    totalCharacters = Number.isFinite(v) ? Math.round(v * 10000) : null;
  }

  function openInNotebook() {
    if (!trimmedTitle) return;
    // Notebook's search DSL from 1.16.0: `book:三体` scopes to that title.
    // We URL-encode via a search param the notebook route will read.
    goto(`${pagePath}/notebook?q=${encodeURIComponent(`book:${trimmedTitle}`)}`);
  }

  function onCoverPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = '封面必须是图片文件';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      error = '封面文件过大（>5MB）';
      return;
    }
    coverFile = file;
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = URL.createObjectURL(file);
    clearCover = false;
    error = '';
  }

  function removeCover() {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = null;
    coverFile = null;
    clearCover = true;
  }

  onDestroy(() => {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    if (existingCoverUrl) URL.revokeObjectURL(existingCoverUrl);
  });

  function close(result?: ManualStatisticEntry) {
    resolver(result);
    dispatch('close');
  }

  async function persistBookMeta() {
    if (!trimmedTitle || !hasBookMeta) return;
    const tags = tagsInput
      .split(/[,，、\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    let coverBlob: Blob | undefined = loadedMeta?.coverBlob;
    let coverMime: string | undefined = loadedMeta?.coverMime;
    if (coverFile) {
      coverBlob = coverFile;
      coverMime = coverFile.type;
    } else if (clearCover) {
      coverBlob = undefined;
      coverMime = undefined;
    }
    await database.upsertManualBook({
      title: trimmedTitle,
      author: author.trim() || undefined,
      translator: translator.trim() || undefined,
      publisher: publisher.trim() || undefined,
      publishedYear: publishedYear ?? undefined,
      isbn: isbn.trim() || undefined,
      totalCharacters: totalCharacters ?? undefined,
      tags: tags.length ? tags : undefined,
      notes: bookNotes.trim() || undefined,
      coverBlob,
      coverMime
    });
  }

  function buildEntry(): ManualStatisticEntry | null {
    if (!trimmedTitle) {
      error = '请输入书名';
      return null;
    }
    if (!dateKey) {
      error = '请选择日期';
      return null;
    }
    if (dateKey > todayKey) {
      error = '日期不能晚于今天';
      return null;
    }
    const readingTimeSeconds = Math.max(0, Math.round(((minutes ?? 0) as number) * 60));
    if (readingTimeSeconds <= 0) {
      error = '请输入阅读时长（分钟）';
      return null;
    }
    const charactersRead = Math.max(0, Math.floor((characters ?? 0) as number));
    return {
      title: trimmedTitle,
      dateKey,
      readingTimeSeconds,
      charactersRead,
      markCompleted,
      conflictStrategy
    };
  }

  async function submit() {
    const entry = buildEntry();
    if (!entry) return;
    try {
      await persistBookMeta();
    } catch (e: any) {
      error = `保存书籍信息失败：${e?.message ?? e}`;
      return;
    }
    close(entry);
  }

  async function submitAndContinue() {
    if (!onSaveAndContinue) return;
    const entry = buildEntry();
    if (!entry) return;
    continuing = true;
    try {
      await persistBookMeta();
      await onSaveAndContinue(entry);
      savedCount += 1;
      // Clear numeric fields + advance date to tomorrow (if not already
      // today) so a "read 30min every day" logging flow is one click.
      // Keep title / metadata / all book-info fields.
      minutes = null;
      characters = null;
      markCompleted = false;
      progressPct = null;
      charsFieldTouched = false;
      error = '';
      // Advance dateKey by 1 day, capped at today.
      const [y, m, d] = dateKey.split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      const yy = next.getFullYear();
      const mm = `${next.getMonth() + 1}`.padStart(2, '0');
      const dd = `${next.getDate()}`.padStart(2, '0');
      const nextKey = `${yy}-${mm}-${dd}`;
      if (nextKey <= todayKey) dateKey = nextKey;
      await tick();
      minutesInputEl?.focus();
    } catch (e: any) {
      error = `保存失败：${e?.message ?? e}`;
    } finally {
      continuing = false;
    }
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">手动添加阅读记录</svelte:fragment>
  <div class="flex flex-col gap-3 text-sm sm:text-base w-80 sm:w-[28rem]" slot="content">
    <label class="flex flex-col">
      <span class="text-xs opacity-70">书名</span>
      <input
        type="text"
        class={inputClasses}
        bind:value={title}
        bind:this={titleInputEl}
        list="manual-existing-titles"
        placeholder="例如：三体（纸质）"
      />
      <datalist id="manual-existing-titles">
        {#each Array.from(new Set(existingTitles.map((k) => k.split('__')[0]))) as t (t)}
          <option value={t} />
        {/each}
      </datalist>
    </label>

    <label class="flex flex-col">
      <span class="text-xs opacity-70">日期</span>
      <input type="date" class={inputClasses} max={todayKey} bind:value={dateKey} />
    </label>

    <div class="flex gap-3">
      <label class="flex flex-col flex-1 min-w-0">
        <span class="text-xs opacity-70">时长（分钟）</span>
        <input
          type="number"
          min="0"
          step="1"
          class={inputClasses}
          bind:value={minutes}
          bind:this={minutesInputEl}
          placeholder="30"
        />
      </label>
      <label class="flex flex-col flex-1 min-w-0">
        <span class="text-xs opacity-70">字数（可留空）</span>
        <input
          type="number"
          min="0"
          step="1"
          class={inputClasses}
          bind:value={characters}
          on:input={() => (charsFieldTouched = true)}
          placeholder="0"
        />
      </label>
    </div>

    {#if totalCharacters}
      <label class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <span class="text-xs opacity-70">读到 {progressPct ?? 0}%</span>
          <span class="text-[11px] opacity-50">
            约 {(((progressPct ?? 0) * totalCharacters) / 100 / 10000).toFixed(1)} 万字（总
            {(totalCharacters / 10000).toFixed(1)} 万）
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={progressPct ?? 0}
          on:input={onProgressPctInput}
        />
      </label>
    {/if}

    <label class="flex items-center gap-2 mt-1">
      <input type="checkbox" bind:checked={markCompleted} />
      <span>标记为读完</span>
    </label>

    {#if trimmedTitle}
      <button
        type="button"
        class="self-start text-xs opacity-70 hover:opacity-100 underline underline-offset-2"
        on:click={openInNotebook}
        title="打开笔记本并过滤到这本书的高亮 / 笔记"
      >
        在笔记本打开{noteCount ? `（${noteCount} 条）` : ''}
      </button>
    {/if}

    <!-- Book metadata (collapsible) -->
    <div class="mt-2 border-t border-gray-500/25 pt-2">
      <button
        type="button"
        class="w-full flex items-center justify-between text-xs opacity-70 hover:opacity-100 py-1"
        on:click={() => (showBookMeta = !showBookMeta)}
      >
        <span
          >书籍信息 {hasBookMeta ? '·' : ''}
          {#if hasBookMeta}
            <span class="opacity-80">{[author, publisher].filter(Boolean).join(' · ')}</span>
          {/if}</span
        >
        <span class="text-[10px]">{showBookMeta ? '收起 ▲' : '展开 ▼'}</span>
      </button>
      {#if showBookMeta}
        <div class="flex flex-col gap-2 mt-2">
          <div class="flex gap-3">
            <label class="flex flex-col flex-1 min-w-0">
              <span class="text-[11px] opacity-70">作者</span>
              <input type="text" class={inputClasses} bind:value={author} placeholder="刘慈欣" />
            </label>
            <label class="flex flex-col flex-1 min-w-0">
              <span class="text-[11px] opacity-70">译者（如有）</span>
              <input type="text" class={inputClasses} bind:value={translator} placeholder="" />
            </label>
          </div>
          <div class="flex gap-3">
            <label class="flex flex-col flex-[2] min-w-0">
              <span class="text-[11px] opacity-70">出版社</span>
              <input type="text" class={inputClasses} bind:value={publisher} placeholder="重庆出版社" />
            </label>
            <label class="flex flex-col flex-1 min-w-0">
              <span class="text-[11px] opacity-70">出版年</span>
              <input
                type="number"
                min="1000"
                max="2100"
                step="1"
                class={inputClasses}
                bind:value={publishedYear}
                placeholder="2008"
              />
            </label>
          </div>
          <div class="flex gap-3">
            <label class="flex flex-col flex-[2] min-w-0">
              <span class="text-[11px] opacity-70">ISBN</span>
              <input type="text" class={inputClasses} bind:value={isbn} placeholder="978-…" />
            </label>
            <label class="flex flex-col flex-1 min-w-0">
              <span class="text-[11px] opacity-70">总字数（万）</span>
              <input
                type="number"
                min="0"
                step="0.1"
                class={inputClasses}
                value={totalCharacters !== null ? totalCharacters / 10000 : ''}
                on:input={onTotalCharsInput}
                placeholder="28.5"
              />
            </label>
          </div>
          <label class="flex flex-col">
            <span class="text-[11px] opacity-70">标签（逗号、顿号或换行分隔）</span>
            <input type="text" class={inputClasses} bind:value={tagsInput} placeholder="科幻, 长篇" />
          </label>
          <label class="flex flex-col">
            <span class="text-[11px] opacity-70">备注</span>
            <textarea
              class="{inputClasses} min-h-[3rem] resize-y"
              bind:value={bookNotes}
              placeholder="购入时间 / 阅读缘由 / 想法…"
            ></textarea>
          </label>
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              {#if coverPreviewUrl}
                <img src={coverPreviewUrl} alt="cover preview" class="h-24 w-16 object-cover rounded border border-gray-500/40" />
              {:else if existingCoverUrl && !clearCover}
                <img src={existingCoverUrl} alt="existing cover" class="h-24 w-16 object-cover rounded border border-gray-500/40" />
              {:else}
                <div class="h-24 w-16 rounded border border-dashed border-gray-500/40 flex items-center justify-center text-[10px] opacity-40">
                  无封面
                </div>
              {/if}
            </div>
            <div class="flex flex-col gap-1 flex-1">
              <span class="text-[11px] opacity-70">封面（可选，≤5MB）</span>
              <input
                type="file"
                accept="image/*"
                on:change={onCoverPicked}
                class="text-xs"
              />
              {#if coverPreviewUrl || (existingCoverUrl && !clearCover)}
                <button type="button" class="text-[11px] opacity-60 hover:opacity-100 self-start" on:click={removeCover}>
                  移除封面
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if hasConflict}
      <div class="mt-2 border border-yellow-500/60 rounded p-2 text-xs">
        <div class="mb-1 font-medium text-yellow-600">
          该书籍在 {dateKey} 已有一条记录：
        </div>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={conflictStrategy} value="append" />
          <span>追加到已有记录（时长与字数相加）</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={conflictStrategy} value="overwrite" />
          <span>覆盖已有记录</span>
        </label>
      </div>
    {/if}

    {#if error}
      <div class="text-red-500 text-xs">{error}</div>
    {/if}
  </div>
  <div class="flex grow justify-between items-center gap-2" slot="footer">
    <button class={buttonClasses} on:click={() => close(undefined)} disabled={continuing}>
      {savedCount > 0 ? '完成' : '取消'}
      <Ripple />
    </button>
    <div class="flex-1 text-center text-[11px] opacity-60">
      {#if savedCount > 0}已保存 {savedCount} 条{/if}
    </div>
    <div class="flex gap-2">
      {#if onSaveAndContinue}
        <button
          class={buttonClasses}
          on:click={submitAndContinue}
          disabled={continuing}
          title="保存后清空时长/字数并前进一天，方便连续录入同一本书的多天记录"
        >
          {continuing ? '保存中…' : '保存并继续'}
          <Ripple />
        </button>
      {/if}
      <button class={buttonClasses} on:click={submit} disabled={continuing}>
        添加
        <Ripple />
      </button>
    </div>
  </div>
</DialogTemplate>
