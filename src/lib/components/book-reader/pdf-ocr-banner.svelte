<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faMagnifyingGlass, faStop } from '@fortawesome/free-solid-svg-icons';
  import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import {
    abortOcrJob,
    clearOcrJob,
    isOcrJobRunning,
    ocrJob$,
    startOcrJob,
    type OcrLanguage
  } from '$lib/functions/file-loaders/pdf/ocr-job-manager';
  import { pdfOcrPromptEnabled$, pdfOcrSkippedBookIds$ as ocrSkippedBooks$ } from '$lib/data/store';

  export let book: BooksDbBookData;

  const ocrLang$ = writableStringLocalStorageSubject()('pdfOcrLang', 'ch');

  const dispatch = createEventDispatcher<{ dismissed: void }>();

  $: skippedIds = new Set(($ocrSkippedBooks$ || '').split(',').filter(Boolean).map(Number));
  $: skippedForThisBook = book?.id != null && skippedIds.has(book.id);

  // Paddle's `ch` model handles Simplified Chinese + English + common
  // punctuation in one go, which covers ~95% of imported scans. Other
  // codes select the dedicated rec model.
  const LANGS: Array<{ code: string; label: string }> = [
    { code: 'ch', label: '中文（简中 + 英文）' },
    { code: 'chinese_cht', label: '繁体中文' },
    { code: 'japan', label: '日本語' },
    { code: 'korean', label: '한국어' },
    { code: 'en', label: 'English' }
  ];

  let dismissed = false;
  // Job state for THIS book only — ignore jobs belonging to other books.
  $: jobForThisBook = $ocrJob$ && $ocrJob$.bookId === book.id ? $ocrJob$ : null;
  $: otherBookRunning = !!$ocrJob$ && $ocrJob$.bookId !== book.id && $ocrJob$.status === 'running';

  function start() {
    if (isOcrJobRunning()) return;
    startOcrJob(book, $ocrLang$ as OcrLanguage);
  }

  function applyAndReload() {
    clearOcrJob();
    window.location.reload();
  }

  function dismissResult() {
    clearOcrJob();
  }

  function dismiss() {
    dismissed = true;
    dispatch('dismissed');
  }

  function dontAskForThisBook() {
    if (book?.id == null) return;
    const next = new Set(skippedIds);
    next.add(book.id);
    $ocrSkippedBooks$ = Array.from(next).join(',');
    dismissed = true;
    dispatch('dismissed');
  }
</script>

{#if !dismissed && !skippedForThisBook && $pdfOcrPromptEnabled$}
  <div class="banner">
    {#if jobForThisBook?.status === 'running'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">OCR 运行中… {jobForThisBook.progress.page} / {jobForThisBook.progress.total} 页</div>
        {#if jobForThisBook.progress.text}
          <div class="meta">{jobForThisBook.progress.text.slice(0, 80)}…</div>
        {:else}
          <div class="meta">可以切到其它书继续阅读，OCR 会在后台继续</div>
        {/if}
      </div>
      <button class="btn danger" on:click={abortOcrJob}><Fa icon={faStop} size="xs" /> 中止</button>
    {:else if jobForThisBook?.status === 'finished'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">OCR 完成（共 {jobForThisBook.progress.total} 页）</div>
        <div class="meta">点「应用」刷新阅读器加载新内容</div>
      </div>
      <button class="btn primary" on:click={applyAndReload}>应用并刷新</button>
      <button class="btn ghost" on:click={dismissResult} title="稍后再说"><Fa icon={faTimes} /></button>
    {:else if jobForThisBook?.status === 'errored'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">OCR 失败</div>
        <div class="meta">{jobForThisBook.error}</div>
      </div>
      <button class="btn primary" on:click={start}>重试</button>
      <button class="btn ghost" on:click={dismissResult}><Fa icon={faTimes} /></button>
    {:else}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">检测到扫描版 PDF（无文字层）</div>
        <div class="meta">
          {otherBookRunning
            ? `「${$ocrJob$?.bookTitle}」正在 OCR — 中止后才能开始这本`
            : '运行 OCR 后可被打字机 / AI / 词典使用，首次会下载语言模型'}
        </div>
      </div>
      <label class="lang">
        <select bind:value={$ocrLang$} disabled={otherBookRunning}>
          {#each LANGS as l (l.code)}
            <option value={l.code}>{l.label}</option>
          {/each}
        </select>
      </label>
      <button class="btn primary" on:click={start} disabled={otherBookRunning}>开始</button>
      <button class="btn" on:click={dontAskForThisBook} title="只看原图，不要再为这本书提示">仅看原图</button>
      <button class="btn ghost" on:click={dismiss} title="本次会话不再提示"><Fa icon={faTimes} /></button>
    {/if}
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: env(safe-area-inset-top, 0px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: 90vw;
    margin-top: 0.6rem;
    padding: 0.6rem 1rem;
    border-radius: 0.6rem;
    background: var(--menu-background);
    color: var(--menu-foreground);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    font-size: 0.85rem;
  }
  .ico { font-size: 1rem; opacity: 0.9; }
  .text { flex: 1; min-width: 0; }
  .title { font-weight: 600; }
  .meta { font-size: 0.72rem; opacity: 0.75; margin-top: 0.15rem; }
  .lang select {
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.35rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.78rem;
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.35rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
  }
  .btn.primary { background: rgba(255, 255, 255, 0.18); }
  .btn.danger { background: rgba(220, 90, 90, 0.35); border-color: rgba(220, 90, 90, 0.5); }
  .btn.ghost { background: transparent; border-color: transparent; opacity: 0.7; padding: 0.3rem 0.5rem; }
  .err {
    width: 100%;
    margin-top: 0.4rem;
    font-size: 0.72rem;
    opacity: 0.85;
    color: #ffc8c8;
  }
</style>
