<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
  import { pagePath } from '$lib/data/env';
  import { ocrJob$, clearOcrJob } from '$lib/functions/file-loaders/pdf/ocr-job-manager';

  // Reading searchParams during prerender is not allowed, and ocrJob$ is
  // always null on the server (module state hasn't been touched yet). Gate
  // everything on `browser`.
  $: routeId = browser ? $page.route.id : '';
  $: currentBookId = browser ? Number($page.url.searchParams.get('id') || '') : 0;
  $: insideOcrBook = routeId === '/b' && currentBookId === $ocrJob$?.bookId;
  // Hide while the user is already inside the OCRing book — the full
  // banner is showing there. Show everywhere else (library, statistics,
  // notebook, settings).
  $: visible = browser && $ocrJob$ && !insideOcrBook;

  function openBook() {
    if (!$ocrJob$) return;
    goto(`${pagePath}/b?id=${$ocrJob$.bookId}`);
  }

  function dismissFinished() {
    if ($ocrJob$?.status !== 'running') clearOcrJob();
  }
</script>

{#if visible && $ocrJob$}
  <button type="button" class="mini" on:click={openBook} title="点击跳到对应书">
    <Fa icon={faMagnifyingGlass} />
    {#if $ocrJob$.status === 'running'}
      <span class="label">OCR · {$ocrJob$.bookTitle}</span>
      <span class="pct">{$ocrJob$.progress.page} / {$ocrJob$.progress.total || '?'}</span>
    {:else if $ocrJob$.status === 'finished'}
      <span class="label">OCR 完成 · {$ocrJob$.bookTitle}</span>
      <span class="pct done">应用</span>
    {:else}
      <span class="label">OCR 失败 · {$ocrJob$.bookTitle}</span>
      <button
        type="button"
        class="x"
        on:click|stopPropagation={dismissFinished}
        title="清除"
      >×</button>
    {/if}
  </button>
{/if}

<style>
  .mini {
    position: fixed;
    right: 1rem;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.8rem;
    border-radius: 999px;
    background: var(--menu-background);
    color: var(--menu-foreground);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .label {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pct {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .pct.done {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 0.3rem;
    padding: 0 0.45rem;
  }
  .x {
    margin-left: 0.2rem;
    padding: 0 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font-size: 0.78rem;
  }
</style>
