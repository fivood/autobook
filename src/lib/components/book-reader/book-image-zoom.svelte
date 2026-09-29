<script lang="ts">
  import { browser } from '$app/environment';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlassPlus, faMagnifyingGlassMinus, faExpand } from '@fortawesome/free-solid-svg-icons';
  import { t } from '$lib/i18n';
  // Store + step table live in reader-zoom.ts: Ctrl+wheel has to drive the same
  // level as these buttons, and it works on books where this widget isn't
  // mounted. Persisted globally, so the level carries across books.
  import { bookImageScale$ as scale$, nextImageScale } from '$lib/functions/reader-zoom';

  function step(delta: number) {
    $scale$ = nextImageScale($scale$, delta);
  }

  function reset() {
    $scale$ = 1;
  }

  let collapsed = true;

  // Push scale onto :root as CSS variable so .book-page-image rules can use it.
  $: if (browser) {
    document.documentElement.style.setProperty('--book-image-scale', String($scale$ || 1));
  }
</script>

<div class="zoom-control" class:collapsed>
  {#if collapsed}
    <button class="pill" on:click={() => (collapsed = false)} title={$t('imageZoom.toggle')}>
      <Fa icon={faExpand} />
      <span>{Math.round($scale$ * 100)}%</span>
    </button>
  {:else}
    <button class="btn" on:click={() => step(-1)} title={$t('imageZoom.zoomOut')}><Fa icon={faMagnifyingGlassMinus} /></button>
    <button class="btn val" on:click={reset} title={$t('imageZoom.reset')}>{Math.round($scale$ * 100)}%</button>
    <button class="btn" on:click={() => step(1)} title={$t('imageZoom.zoomIn')}><Fa icon={faMagnifyingGlassPlus} /></button>
    <button class="btn close" on:click={() => (collapsed = true)} title={$t('imageZoom.collapse')}>×</button>
  {/if}
</div>

<style>
  /* Left rail: avoid competing with the typewriter / TTS auto-play FAB
     stack on the right. Small secondary controls (zoom, keyboard help)
     live on the left so the right side is reserved for the primary play
     controls and the bottom of the typewriter doesn't get covered when
     both are visible. */
  .zoom-control {
    position: fixed;
    left: env(safe-area-inset-left, 0.6rem);
    bottom: calc(env(safe-area-inset-bottom, 0.6rem) + 0.8rem);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.4rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.65));
    color: var(--menu-foreground, #fff);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--menu-foreground, #fff) 24%, transparent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    font-size: 0.875rem;
  }
  .zoom-control.collapsed {
    padding: 0;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.55));
    color: var(--menu-foreground, #fff);
    border: 1px solid color-mix(in srgb, var(--menu-foreground, #fff) 24%, transparent);
    border-radius: 999px;
    font-size: 0.875rem;
    cursor: pointer;
    opacity: 0.55;
  }
  .pill:hover {
    opacity: 1;
  }
  .btn {
    background: transparent;
    color: inherit;
    border: 0;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    font-size: 0.875rem;
    border-radius: 0.3rem;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .val {
    min-width: 3.2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .close {
    opacity: 0.7;
    padding: 0.3rem 0.45rem;
  }

  :global(img.book-page-image) {
    width: calc(100% * var(--book-image-scale, 1)) !important;
    max-width: none !important;
    height: auto !important;
    display: block;
    margin: 0 auto;
  }
</style>
