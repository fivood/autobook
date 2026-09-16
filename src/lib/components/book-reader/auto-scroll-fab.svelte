<script lang="ts">
  import { browser } from '$app/environment';
  import Fa from 'svelte-fa';
  import { faPlay, faPause, faForward, faRotateRight, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
  import type { AutoScroller, AutoReader } from '$lib/components/book-reader/types';
  import { autoScrollStopAtChapter$, multiplier$, ttsArmed$ } from '$lib/data/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Subscription } from 'rxjs';
  import { t } from '$lib/i18n';

  export let autoScroller: AutoScroller | undefined;
  /** TTS reader, if mounted alongside. Its rate pill overlays this
   * component's speed pill (same slot under the play button), so while
   * TTS is active the speed pill must fully yield — no visibility, no
   * hover preview. TTS enabling also turns the scroller off, so the
   * pill carries no information in that state anyway. */
  export let autoReader: AutoReader | undefined = undefined;

  let enabled = false;
  let ttsActive = false;
  let sub: Subscription | undefined;
  let ttsSub: Subscription | undefined;
  let recentlyMoved = true;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered = false;

  $: {
    sub?.unsubscribe();
    sub = autoScroller?.wasAutoScrollerEnabled$.subscribe((v) => (enabled = v));
  }

  $: {
    ttsSub?.unsubscribe();
    ttsSub = autoReader?.wasReaderEnabled$.subscribe((v) => (ttsActive = v));
  }

  // Dim the FAB stack 1.2s after the last mouse move while playback is
  // active — keeps the controls accessible (state still visible) without
  // covering the typewriter's active line on the right side.
  $: faded = enabled && !recentlyMoved && !hovered;

  /** A paused TTS session still owns the shared pill slot, so yield on the
   *  armed flag, not just on "currently speaking". */
  $: ttsBusy = ttsActive || $ttsArmed$;

  function nudge() {
    recentlyMoved = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (recentlyMoved = false), 1200);
  }

  onMount(() => {
    if (!browser) return;
    nudge();
    window.addEventListener('mousemove', nudge);
  });

  onDestroy(() => {
    sub?.unsubscribe();
    ttsSub?.unsubscribe();
    if (idleTimer) clearTimeout(idleTimer);
    if (browser) window.removeEventListener('mousemove', nudge);
  });

  function toggle() {
    // Starting the typewriter claims the shared speed-pill slot back from a
    // paused reader.
    if (!enabled) ttsArmed$.next(false);
    autoScroller?.toggle();
  }

  function toggleStopAtChapter() {
    autoScrollStopAtChapter$.next(!$autoScrollStopAtChapter$);
  }

  function decreaseSpeed() {
    const next = Math.max(1, $multiplier$ - 1);
    multiplier$.next(next);
    if (autoScroller) {
      autoScroller.multiplier = next;
    }
  }

  function increaseSpeed() {
    const next = Math.min(60, $multiplier$ + 1);
    multiplier$.next(next);
    if (autoScroller) {
      autoScroller.multiplier = next;
    }
  }
</script>

{#if autoScroller}
  <div
    class="group fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2 transition-opacity duration-300"
    class:opacity-20={faded}
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => (hovered = false)}
    role="toolbar"
    tabindex="-1"
  >
    <button
      type="button"
      title={$autoScrollStopAtChapter$
        ? $t('typewriter.chapterStop.tooltipOn')
        : $t('typewriter.chapterStop.tooltipOff')}
      on:click={toggleStopAtChapter}
      class="menu-surface flex h-9 items-center gap-1 rounded-full px-3 text-sm backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled}
      class:pointer-events-none={!enabled}
      class:group-hover:opacity-100={!enabled}
      class:group-hover:pointer-events-auto={!enabled}
    >
      <Fa icon={$autoScrollStopAtChapter$ ? faRotateRight : faForward} />
      <span>{$autoScrollStopAtChapter$ ? $t('typewriter.chapterStop.on') : $t('typewriter.chapterStop.off')}</span>
    </button>
    <button
      type="button"
      title={enabled ? $t('typewriter.pause') : $t('typewriter.play')}
      on:click={toggle}
      class="relative flex items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-150"
      class:h-12={enabled}
      class:w-12={enabled}
      class:h-9={!enabled}
      class:w-9={!enabled}
      class:opacity-100={enabled}
      class:opacity-30={!enabled}
      class:group-hover:opacity-95={!enabled}
      class:group-hover:h-12={!enabled}
      class:group-hover:w-12={!enabled}
      style="background-color: var(--button-selected); color: var(--menu-foreground);"
    >
      <Fa icon={enabled ? faPause : faPlay} size="lg" />
      <span class="sr-only">{enabled ? $t('typewriter.pauseAria') : $t('typewriter.playAria')}</span>
    </button>

    <div
      class="menu-surface flex items-center gap-1 rounded-full px-2 py-1 backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled || ttsBusy}
      class:pointer-events-none={!enabled || ttsBusy}
      class:group-hover:opacity-100={!enabled && !ttsBusy}
      class:group-hover:pointer-events-auto={!enabled && !ttsBusy}
    >
      <button
        type="button"
        title={$t('typewriter.slower')}
        on:click={decreaseSpeed}
        class="hover-menu-inverted flex h-6 w-6 items-center justify-center rounded-full"
      >
        <Fa icon={faMinus} size="xs" />
      </button>
      <span class="min-w-[2.5rem] text-center text-sm">{$t('typewriter.speedUnit', { n: $multiplier$ })}</span>
      <button
        type="button"
        title={$t('typewriter.faster')}
        on:click={increaseSpeed}
        class="hover-menu-inverted flex h-6 w-6 items-center justify-center rounded-full"
      >
        <Fa icon={faPlus} size="xs" />
      </button>
    </div>
  </div>
{/if}
