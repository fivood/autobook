<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { applyComicOverlay, clearComicOverlay } from '$lib/functions/comic-overlay';

  /** Book title the overlay matches a translation job by. */
  export let title: string;

  const dispatch = createEventDispatcher<{ hasTranslation: void }>();

  let rendered = 0;
  let applied = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let rootEl: HTMLElement | null = null;

  const contentEl = () => document.querySelector('.book-content') as HTMLElement | null;

  // Re-apply when the page images finish loading / the content resizes.
  // Images lazy-load as the user scrolls, and their rendered size drives the
  // coordinate scale, so a stale overlay would drift off the artwork.
  async function apply() {
    const n = await applyComicOverlay({
      title,
      contentEl,
      onApplied: (c) => (rendered = c),
      onHasTranslation: () => dispatch('hasTranslation')
    });
    if (n > 0) applied = true;
  }

  // Images may not have their final box yet when the overlay first applies;
  // poll a few times at a short interval so lazy-loaded pages settle.
  function startPolling() {
    if (timer) return;
    let ticks = 0;
    timer = setInterval(async () => {
      ticks += 1;
      await apply();
      // Keep re-scaling for as long as the overlay exists; stop only when
      // the content root is gone (page unload).
      if (!contentEl()) {
        stopPolling();
        return;
      }
      // Cap the eager re-apply window; afterwards only resize events matter.
      if (ticks > 40) stopPolling();
    }, 500);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  onMount(() => {
    if (!browser) return;
    rootEl = document.querySelector('.book-content') as HTMLElement | null;
    apply().then(() => startPolling());
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => apply());
      // Observe the whole document body — view mode switches swap the
      // content root, and observing just the initial root would miss that.
      resizeObserver.observe(document.body);
    }
  });

  onDestroy(() => {
    stopPolling();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    clearComicOverlay(rootEl);
  });
</script>

{#if applied}
  <div
    class="fixed right-3 top-12 z-20 rounded-full px-2 py-0.5 text-xs"
    style="background:var(--menu-background);color:var(--menu-foreground);opacity:0.75;"
    title="漫画译文覆盖层"
  >
    {rendered} 段译文
  </div>
{/if}
