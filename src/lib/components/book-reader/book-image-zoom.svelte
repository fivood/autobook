<script lang="ts">
  import { browser } from '$app/environment';
  import Fa from 'svelte-fa';
  import { faMagnifyingGlassPlus, faMagnifyingGlassMinus, faExpand } from '@fortawesome/free-solid-svg-icons';
  import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';

  // Persisted globally so the user's preferred zoom carries across books.
  const scale$ = writableNumberLocalStorageSubject()('bookImageScale', 1);

  const STEPS = [0.5, 0.66, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  function nearestIdx(v: number) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < STEPS.length; i++) {
      const d = Math.abs(STEPS[i] - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function step(delta: number) {
    const i = nearestIdx($scale$);
    const next = Math.max(0, Math.min(STEPS.length - 1, i + delta));
    $scale$ = STEPS[next];
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
    <button class="pill" on:click={() => (collapsed = false)} title="图片缩放">
      <Fa icon={faExpand} />
      <span>{Math.round($scale$ * 100)}%</span>
    </button>
  {:else}
    <button class="btn" on:click={() => step(-1)} title="缩小"><Fa icon={faMagnifyingGlassMinus} /></button>
    <button class="btn val" on:click={reset} title="恢复 100%">{Math.round($scale$ * 100)}%</button>
    <button class="btn" on:click={() => step(1)} title="放大"><Fa icon={faMagnifyingGlassPlus} /></button>
    <button class="btn close" on:click={() => (collapsed = true)} title="收起">×</button>
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
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    font-size: 0.78rem;
  }
  .zoom-control.collapsed {
    padding: 0;
    background: transparent;
    box-shadow: none;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    background: var(--menu-background, rgba(0, 0, 0, 0.55));
    color: var(--menu-foreground, #fff);
    border: none;
    border-radius: 999px;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0.55;
  }
  .pill:hover {
    opacity: 1;
  }
  .btn {
    background: transparent;
    color: inherit;
    border: none;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    font-size: 0.78rem;
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
