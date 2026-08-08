<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faArrowRightArrowLeft, faTimes } from '@fortawesome/free-solid-svg-icons';
  import { writableSubject } from '$lib/functions/svelte/store';
  import { t } from '$lib/i18n';

  export let bookId: number;
  export let bookTitle: string;

  const dispatch = createEventDispatcher<{ translate: void }>();

  function readDismissed(): string {
    try {
      return localStorage.getItem('comicTranslateBannerDismissed') || '';
    } catch {
      return '';
    }
  }

  // Per-book dismiss, persisted so an OCR'd / translated book doesn't nag on
  // every open. Comics have no text layer, so this banner's job is done once
  // the user has moved on to /translate.
  const dismissedIds$ = writableSubject(readDismissed());

  $: dismissed = ($dismissedIds$ || '')
    .split(',')
    .filter(Boolean)
    .includes(String(bookId));

  function dismiss() {
    const current = dismissedIds$.getValue().split(',').filter(Boolean);
    if (!current.includes(String(bookId))) current.push(String(bookId));
    const next = current.join(',');
    dismissedIds$.next(next);
    try {
      localStorage.setItem('comicTranslateBannerDismissed', next);
    } catch {
      // Persist failure only loses the "don't ask again" memory for this book.
    }
  }

  function go() {
    dispatch('translate');
  }
</script>

{#if !dismissed}
  <div class="banner">
    <Fa icon={faArrowRightArrowLeft} class="ico" />
    <div class="text">
      <div class="title">{$t('comicTranslateBanner.title')}</div>
      <div class="meta">{$t('comicTranslateBanner.meta', { title: bookTitle })}</div>
    </div>
    <button class="btn primary" on:click={go}>{$t('comicTranslateBanner.action')}</button>
    <button class="btn ghost" on:click={dismiss} title={$t('comicTranslateBanner.dismiss')}>
      <Fa icon={faTimes} />
    </button>
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
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.35rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
  }
  .btn.primary { background: rgba(255, 255, 255, 0.18); }
  .btn.ghost { background: transparent; border-color: transparent; opacity: 0.7; padding: 0.3rem 0.5rem; }
</style>
