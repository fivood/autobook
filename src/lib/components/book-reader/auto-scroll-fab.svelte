<script lang="ts">
  import { browser } from '$app/environment';
  import Fa from 'svelte-fa';
  import { faPlay, faPause, faForward, faRotateRight, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
  import type { AutoScroller } from '$lib/components/book-reader/types';
  import { autoScrollStopAtChapter$, multiplier$ } from '$lib/data/store';
  import { onDestroy, onMount } from 'svelte';
  import type { Subscription } from 'rxjs';

  export let autoScroller: AutoScroller | undefined;

  let enabled = false;
  let sub: Subscription | undefined;
  let recentlyMoved = true;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered = false;

  $: {
    sub?.unsubscribe();
    sub = autoScroller?.wasAutoScrollerEnabled$.subscribe((v) => (enabled = v));
  }

  // Dim the FAB stack 1.2s after the last mouse move while playback is
  // active — keeps the controls accessible (state still visible) without
  // covering the typewriter's active line on the right side.
  $: faded = enabled && !recentlyMoved && !hovered;

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
    if (idleTimer) clearTimeout(idleTimer);
    if (browser) window.removeEventListener('mousemove', nudge);
  });

  function toggle() {
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
  >
    <button
      type="button"
      title={$autoScrollStopAtChapter$
        ? '播完本章自动停止（点击切换为：跨章继续）'
        : '跨章连续播放（点击切换为：播完本章停止）'}
      on:click={toggleStopAtChapter}
      class="flex h-9 items-center gap-1 rounded-full px-3 text-xs shadow backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled}
      class:pointer-events-none={!enabled}
      class:group-hover:opacity-100={!enabled}
      class:group-hover:pointer-events-auto={!enabled}
      style="background-color: rgba(195, 193, 175, 0.9); color: #405a5c;"
    >
      <Fa icon={$autoScrollStopAtChapter$ ? faRotateRight : faForward} />
      <span>{$autoScrollStopAtChapter$ ? '章止' : '连播'}</span>
    </button>
    <button
      type="button"
      title={enabled ? '暂停打字机 (Space)' : '开始打字机阅读 (Space) · A 加速 / D 减速'}
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
      style="background-color: rgba(95, 126, 123, 0.92); color: #f0efe6;"
    >
      <Fa icon={enabled ? faPause : faPlay} size="lg" />
      <span class="sr-only">{enabled ? '暂停' : '开始'}自动阅读</span>
      {#if enabled}
        <span
          class="absolute -top-2 -right-2 min-w-[2rem] rounded-full bg-black/40 px-1 text-[10px] leading-5"
          title="速度 (A 加速 / D 减速)"
        >
          {$multiplier$}字/秒
        </span>
      {/if}
    </button>

    <div
      class="flex items-center gap-1 rounded-full px-2 py-1 shadow backdrop-blur transition-all duration-150"
      class:opacity-0={!enabled}
      class:pointer-events-none={!enabled}
      class:group-hover:opacity-100={!enabled}
      class:group-hover:pointer-events-auto={!enabled}
      style="background-color: rgba(195, 193, 175, 0.9); color: #405a5c;"
    >
      <button
        type="button"
        title="减速 (D)"
        on:click={decreaseSpeed}
        class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/10"
      >
        <Fa icon={faMinus} size="xs" />
      </button>
      <span class="min-w-[2.5rem] text-center text-[10px]">{$multiplier$} 字/秒</span>
      <button
        type="button"
        title="加速 (A)"
        on:click={increaseSpeed}
        class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/10"
      >
        <Fa icon={faPlus} size="xs" />
      </button>
    </div>
  </div>
{/if}
