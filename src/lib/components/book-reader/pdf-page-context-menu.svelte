<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlass, faRotateRight } from '@fortawesome/free-solid-svg-icons';
  import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
  import { database } from '$lib/data/store';
  import { runOcrOnPage } from '$lib/functions/file-loaders/pdf/pdf-ocr-runner';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import type { OcrLanguage } from '$lib/functions/file-loaders/pdf/pdf-ocr';

  export let book: BooksDbBookData;

  const ocrLang$ = writableStringLocalStorageSubject()('pdfOcrLang', 'ch');

  const LANGS: Array<{ code: OcrLanguage; label: string }> = [
    { code: 'ch', label: '中文（简中 + 英文）' },
    { code: 'chinese_cht', label: '繁体中文' },
    { code: 'japan', label: '日本語' },
    { code: 'korean', label: '한국어' },
    { code: 'en', label: 'English' }
  ];

  let visible = false;
  let menuX = 0;
  let menuY = 0;
  let targetPage = 0;
  let busy = false;
  let message = '';
  let showLangPicker = false;

  function onContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target) return;
    const img = target.closest('img.pdf-page-img, img.book-page-image') as HTMLImageElement | null;
    if (!img) return;
    const pageAttr = img.getAttribute('data-pdf-page');
    if (!pageAttr) return;
    e.preventDefault();
    targetPage = Number(pageAttr);
    menuX = e.clientX;
    menuY = e.clientY;
    visible = true;
    showLangPicker = false;
    message = '';
  }

  function close() {
    visible = false;
    showLangPicker = false;
  }

  function runReocrWithSavedLang() {
    return reocr($ocrLang$ as OcrLanguage);
  }

  async function reocr(lang: OcrLanguage) {
    if (busy) return;
    visible = false;
    busy = true;
    message = `重新识别第 ${targetPage} 页…`;
    try {
      const { updated, recognized } = await runOcrOnPage(book, targetPage, lang);
      const db = await database.db;
      await db.put('data', updated);
      message = recognized
        ? `第 ${targetPage} 页识别完成（${recognized.length} 字），即将刷新…`
        : `第 ${targetPage} 页未检测到文字（图片 / 空白页），即将刷新…`;
      setTimeout(() => window.location.reload(), 900);
    } catch (err: any) {
      message = `第 ${targetPage} 页识别失败：${err?.message || err}`;
      busy = false;
      setTimeout(() => (message = ''), 4000);
    }
  }

  onMount(() => {
    if (!browser) return;
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', close);
    document.addEventListener('scroll', close, true);
  });

  onDestroy(() => {
    if (!browser) return;
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('click', close);
    document.removeEventListener('scroll', close, true);
  });
</script>

{#if visible}
  <div
    class="ctx-menu"
    style="left:{menuX}px;top:{menuY}px;"
    on:click|stopPropagation
    on:keyup|stopPropagation
    role="menu"
    tabindex="-1"
  >
    <div class="hint">第 {targetPage} 页</div>
    {#if !showLangPicker}
      <button class="item" on:click={runReocrWithSavedLang}>
        <Fa icon={faRotateRight} size="xs" />
        <span>重新识别这页</span>
        <span class="meta">{LANGS.find((l) => l.code === $ocrLang$)?.label || $ocrLang$}</span>
      </button>
      <button class="item" on:click={() => (showLangPicker = true)}>
        <Fa icon={faMagnifyingGlass} size="xs" />
        <span>用其它语言识别…</span>
      </button>
    {:else}
      {#each LANGS as l (l.code)}
        <button class="item lang" on:click={() => reocr(l.code)}>
          {l.label}
        </button>
      {/each}
    {/if}
  </div>
{/if}

{#if busy || message}
  <div class="toast">{message}</div>
{/if}

<style>
  .ctx-menu {
    position: fixed;
    z-index: 30;
    min-width: 14rem;
    padding: 0.3rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.85));
    color: var(--menu-foreground, #fff);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font-size: 0.85rem;
  }
  .hint {
    padding: 0.3rem 0.6rem;
    font-size: 0.7rem;
    opacity: 0.55;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    margin-bottom: 0.25rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .item:hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .item .meta {
    margin-left: auto;
    font-size: 0.7rem;
    opacity: 0.55;
  }
  .item.lang {
    font-size: 0.78rem;
  }
  .toast {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    padding: 0.5rem 0.9rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.85));
    color: var(--menu-foreground, #fff);
    border-radius: 0.4rem;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    font-size: 0.8rem;
  }
</style>
