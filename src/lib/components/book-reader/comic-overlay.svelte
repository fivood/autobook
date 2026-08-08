<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { applyComicOverlay, clearComicOverlay } from '$lib/functions/comic-overlay';
  import { inpaintPage } from '$lib/functions/comic-inpaint';
  import {
    addManualRegion,
    getManualRegions,
    removeManualRegion,
    getAllManualRegions,
    getBubbleOrder,
    setBubbleOrder
  } from '$lib/functions/comic-inpaint-regions';
  import { TauriComicStorage } from '$lib/data/translation/comic-storage-tauri';
  import { isTauri } from '$lib/data/env';
  import { findComicTranslationJob } from '$lib/data/translation/translation-job-store';
  import { t } from '$lib/i18n';

  /** Book title the overlay matches a translation job by. */
  export let title: string;

  const dispatch = createEventDispatcher<{ hasTranslation: void }>();

  let rendered = 0;
  let applied = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let rootEl: HTMLElement | null = null;
  let cacheKey = '';
  /** Cover-skip offset from the job; maps raw data-pdf-page to slice index. */
  let startPage = 0;

  // ── Edit mode (manual inpainting) ───────────────────────────────────
  let editMode = false;
  let drawing = false;
  let dragStart = { x: 0, y: 0 };
  let dragRect = { x: 0, y: 0, w: 0, h: 0 };
  let dragPage = 0;
  let dragImg: HTMLImageElement | null = null;
  /** Most recently drawn manual region, so it can be undone. */
  let lastRegion: { pageIndex: number; id: string } | undefined;
  /** In edit mode, the first bubble picked for a swap. */
  let swapPick: { pageIndex: number; id: string } | undefined;

  const contentEl = () => document.querySelector('.book-content') as HTMLElement | null;

  async function apply() {
    const n = await applyComicOverlay({
      title,
      contentEl,
      onApplied: (c) => (rendered = c),
      onHasTranslation: () => dispatch('hasTranslation'),
      onSpanCreated: (span, bubble, order) => {
        if (!editMode || !cacheKey) return;
        // Order badge + click-to-swap in edit mode.
        span.dataset.bubbleId = bubble.id;
        span.dataset.pageIndex = String(bubble.pageIndex);
        span.dataset.order = String(order);
        if (swapPick && swapPick.id === bubble.id && swapPick.pageIndex === bubble.pageIndex) {
          span.dataset.selected = 'true';
        }
        const badge = document.createElement('span');
        badge.textContent = String(order + 1);
        badge.className = 'comic-order-badge';
        badge.style.cssText =
          'position:absolute;top:0;left:0;transform:translate(-40%,-40%);' +
          'background:var(--menu-background,#222);color:var(--menu-foreground,#fff);' +
          'font-size:10px;line-height:1;padding:2px 5px;border-radius:999px;' +
          'pointer-events:auto;cursor:pointer;z-index:3;box-shadow:0 1px 3px rgba(0,0,0,0.5);';
        badge.addEventListener('click', (ev) => {
          ev.stopPropagation();
          handleSwapClick(bubble.id, bubble.pageIndex);
        });
        span.appendChild(badge);
        span.style.pointerEvents = 'auto';
        span.addEventListener('click', (ev) => {
          ev.stopPropagation();
          handleSwapClick(bubble.id, bubble.pageIndex);
        });
      },
      inpaintStorage: isTauri() ? new TauriComicStorage() : undefined
    });
    if (n > 0) applied = true;
  }

  /** Click two bubbles to swap their reading order. */
  async function handleSwapClick(id: string, pageIndex: number) {
    if (!cacheKey) return;
    if (!swapPick) {
      swapPick = { pageIndex, id };
      await apply(); // re-render to highlight the picked bubble
      return;
    }
    if (swapPick.pageIndex !== pageIndex || swapPick.id === id) {
      swapPick = undefined;
      await apply();
      return;
    }
    // Load current order (manual or default), swap the two ids, persist.
    const job = await findComicTranslationJob(title);
    const state = job?.document.state as { bubbles?: Array<{ id: string; pageIndex: number }> } | undefined;
    const pageBubbles = (state?.bubbles || []).filter((b) => b.pageIndex === pageIndex);
    const base = getBubbleOrder(cacheKey, pageIndex) || pageBubbles.map((b) => b.id);
    const a = base.indexOf(swapPick.id);
    const b = base.indexOf(id);
    if (a >= 0 && b >= 0) {
      const next = [...base];
      next[a] = base[b];
      next[b] = base[a];
      setBubbleOrder(cacheKey, pageIndex, next);
    }
    swapPick = undefined;
    await apply();
  }

  function startPolling() {
    if (timer) return;
    let ticks = 0;
    timer = setInterval(async () => {
      ticks += 1;
      await apply();
      if (!contentEl()) { stopPolling(); return; }
      if (ticks > 40) stopPolling();
    }, 500);
  }

  function stopPolling() {
    if (timer) { clearInterval(timer); timer = undefined; }
  }

  onMount(async () => {
    if (!browser) return;
    rootEl = document.querySelector('.book-content') as HTMLElement | null;
    // Resolve the cache key + cover offset once so manual regions and page
    // mapping target the right comic / page index.
    const job = await findComicTranslationJob(title);
    cacheKey = (job?.document.metadata?.cacheKey as string) || '';
    startPage = Number(job?.document.metadata?.startPage) || 0;
    apply().then(() => startPolling());
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => apply());
      resizeObserver.observe(document.body);
    }
  });

  onDestroy(() => {
    stopPolling();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    clearComicOverlay(rootEl);
  });

  // ── Edit mode helpers ────────────────────────────────────────────────

  /** Mouse position in image pixel coords (for inpainting). */
  function toImagePx(img: HTMLImageElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = img.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * img.naturalWidth,
      y: ((clientY - rect.top) / rect.height) * img.naturalHeight
    };
  }

  function onMouseDown(ev: MouseEvent) {
    if (!editMode || ev.button !== 0) return;
    // Clicking a bubble (to re-order) must not start a selection drag.
    const overlay = (ev.target as HTMLElement).closest('.comic-translation-overlay') as HTMLElement | null;
    if (overlay) return;
    const img = (ev.target as HTMLElement).closest('img[data-pdf-page]') as HTMLImageElement | null;
    if (!img) return;
    ev.preventDefault();
    const pageAttr = img.getAttribute('data-pdf-page');
    if (!pageAttr) return;
    drawing = true;
    // raw data-pdf-page (1-based full book) → slice index (0-based, cover
    // skipped during OCR) so manual regions + inpaint cache line up.
    dragPage = Number(pageAttr) - 1 - startPage;
    dragImg = img;
    // Store DOM coords for drawing; convert to image px on mouseup.
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragRect = { x: ev.clientX, y: ev.clientY, w: 0, h: 0 };
  }

  function onMouseMove(ev: MouseEvent) {
    if (!drawing || !dragImg) return;
    dragRect = {
      x: Math.min(dragStart.x, ev.clientX),
      y: Math.min(dragStart.y, ev.clientY),
      w: Math.abs(ev.clientX - dragStart.x),
      h: Math.abs(ev.clientY - dragStart.y)
    };
  }

  async function onMouseUp() {
    if (!drawing) return;
    drawing = false;
    if (!dragImg || dragRect.w < 20 || dragRect.h < 20) {
      dragImg = null;
      dragRect = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }
    // Convert DOM rect to image pixel rect for inpainting.
    const p0 = toImagePx(dragImg, dragRect.x, dragRect.y);
    const p1 = toImagePx(dragImg, dragRect.x + dragRect.w, dragRect.y + dragRect.h);
    const imgRect = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
    await inpaintDrawnRegion(dragPage, imgRect);
    dragImg = null;
    dragRect = { x: 0, y: 0, w: 0, h: 0 };
  }

  /** Erase the user-drawn rectangle and persist it as a manual region. */
  async function inpaintDrawnRegion(pageIndex: number, rect: { x: number; y: number; w: number; h: number }) {
    if (!cacheKey) return;
    const id = `manual_${Date.now()}`;
    const poly: [number, number][] = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h]
    ];
    addManualRegion(cacheKey, pageIndex, { id, poly });
    lastRegion = { pageIndex, id };
    await reapplyPageInpaint(pageIndex);
  }

  /** Re-run inpainting for a page with OCR bubbles + manual regions merged. */
  async function reapplyPageInpaint(pageIndex: number) {
    if (!cacheKey || !isTauri()) return;
    const storage = new TauriComicStorage();
    const ocrBlobs = await storage.readPage(cacheKey, pageIndex);
    if (!ocrBlobs) return;
    const manual = getManualRegions(cacheKey, pageIndex);
    // OCR bubbles come from the job's document state.
    const job = await findComicTranslationJob(title);
    const state = job?.document.state as { bubbles?: Array<{ id: string; pageIndex: number; poly: [number, number][] }> } | undefined;
    const ocrBubbles = (state?.bubbles || [])
      .filter((b) => b.pageIndex === pageIndex)
      .map((b) => ({ id: b.id, poly: b.poly }));
    const { result, blob } = await inpaintPage(ocrBlobs, [...ocrBubbles, ...manual]);
    if (result.inpainted > 0) {
      await storage.writeInpainted(cacheKey, pageIndex, blob);
    }
    apply();
  }

  /** Remove a persisted manual region and re-erase the page. */
  async function removeRegion(pageIndex: number, id: string) {
    removeManualRegion(cacheKey, pageIndex, id);
    await reapplyPageInpaint(pageIndex);
  }

  /** Undo the most recently drawn region. */
  async function undoLastRegion() {
    if (!lastRegion) return;
    await removeRegion(lastRegion.pageIndex, lastRegion.id);
    lastRegion = undefined;
  }

  $: manualCount = cacheKey
    ? Object.values(getAllManualRegions(cacheKey)).reduce((sum, list) => sum + list.length, 0)
    : 0;
</script>

{#if applied}
  <div class="fixed right-3 top-12 z-20 flex items-center gap-2">
    <div
      class="rounded-full px-2 py-0.5 text-xs"
      style="background:var(--menu-background);color:var(--menu-foreground);opacity:0.75;"
      title={$t('comicOverlay.translations')}
    >
      {rendered} 段译文{manualCount ? ` · ${manualCount} 手动` : ''}
    </div>
    <button
      class="rounded-full px-3 py-0.5 text-xs"
      style="background:var(--menu-background);color:var(--menu-foreground);"
      class:!opacity-100={editMode}
      on:click={() => {
        editMode = !editMode;
        swapPick = undefined;
        apply();
      }}
      title={$t('comicOverlay.editMode')}
    >
      {editMode ? $t('comicOverlay.exitEdit') : $t('comicOverlay.edit')}
    </button>
  </div>
{/if}

{#if editMode}
  <!-- Drag target: draw a rectangle on the current page image to erase it. -->
  <div
    class="fixed inset-0 z-30 cursor-crosshair"
    on:mousedown={onMouseDown}
    on:mousemove={onMouseMove}
    on:mouseup={onMouseUp}
    on:mouseleave={onMouseUp}
  >
    {#if drawing && dragImg && dragRect.w > 0 && dragRect.h > 0}
      <div
        class="pointer-events-none fixed border-2 border-dashed"
        style="left:{dragRect.x}px;top:{dragRect.y}px;width:{dragRect.w}px;height:{dragRect.h}px;border-color:var(--danger-color,#e05555);"
      ></div>
    {/if}
  </div>
  <div
    class="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm"
    style="background:var(--menu-background);color:var(--menu-foreground);"
  >
    {#if swapPick}
      <span>{$t('comicOverlay.swapHint')}</span>
    {:else if manualCount}
      <span>{$t('comicOverlay.manualHint')} · {manualCount}</span>
    {:else}
      <span>{$t('comicOverlay.manualHint')}</span>
    {/if}
    {#if lastRegion}
      <button
        class="rounded border border-current/40 px-2 py-0.5 text-xs hover-menu-inverted"
        on:click={undoLastRegion}
      >
        {$t('comicOverlay.undo')}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Highlight the bubble picked for a swap in edit mode. */
  :global(.comic-translation-overlay[data-selected='true']) {
    outline: 2px solid var(--danger-color, #e05555);
    outline-offset: -2px;
    background: rgba(0, 0, 0, 0.25);
  }
</style>
