<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount, onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlass, faRotateRight } from '@fortawesome/free-solid-svg-icons';
  import { database, pdfOcrLang$ } from '$lib/data/store';
  import { runOcrOnPage } from '$lib/functions/file-loaders/pdf/pdf-ocr-runner';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import type { OcrLanguage } from '$lib/functions/file-loaders/pdf/pdf-ocr';
  import { t, tImmediate } from '$lib/i18n';

  export let book: BooksDbBookData;

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

  // Per-book language wins over the global default, matching the OCR banner.
  $: savedLang = (book.ocrLang || $pdfOcrLang$) as OcrLanguage;

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
    return reocr(savedLang);
  }

  async function reocr(lang: OcrLanguage) {
    if (busy) return;
    visible = false;
    busy = true;
    message = tImmediate('pdfCtx.reOcrProgress', { n: targetPage });
    try {
      const { updated, recognized } = await runOcrOnPage(book, targetPage, lang);
      const db = await database.db;
      // Persist the language this page was re-OCR'd with onto the book so the
      // banner and next re-OCR agree, even if the global default differs.
      if (book.ocrLang !== lang) {
        updated.ocrLang = lang;
      }
      await db.put('data', updated);
      message = recognized
        ? tImmediate('pdfCtx.reOcrDone', { n: targetPage, chars: recognized.length })
        : tImmediate('pdfCtx.reOcrEmpty', { n: targetPage });
      setTimeout(() => window.location.reload(), 900);
    } catch (err: any) {
      message = tImmediate('pdfCtx.reOcrFailed', { n: targetPage, err: err?.message || err });
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
    class="ctx-menu menu-surface menu-panel"
    style="left:{menuX}px;top:{menuY}px;"
    on:click|stopPropagation
    on:keyup|stopPropagation
    role="menu"
    tabindex="-1"
  >
    <div class="hint menu-label">{$t('pdfCtx.pageLabel', { n: targetPage })}</div>
    {#if !showLangPicker}
      <button class="item menu-item" on:click={runReocrWithSavedLang}>
        <Fa icon={faRotateRight} size="xs" />
        <span>{$t('pdfCtx.reOcrThisPage')}</span>
        <span class="meta">{LANGS.find((l) => l.code === savedLang)?.label || savedLang}</span>
      </button>
      <button class="item menu-item" on:click={() => (showLangPicker = true)}>
        <Fa icon={faMagnifyingGlass} size="xs" />
        <span>{$t('pdfCtx.otherLanguage')}</span>
      </button>
    {:else}
      {#each LANGS as l (l.code)}
        <button class="item menu-item lang" on:click={() => reocr(l.code)}>
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
  }
  .hint {
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    margin-bottom: 0.35rem;
  }
  .item {
    justify-content: flex-start;
  }
  .item .meta {
    margin-left: auto;
    font-size: 0.8125rem;
    opacity: 0.55;
  }
  .item.lang {
    font-size: 0.9375rem;
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
