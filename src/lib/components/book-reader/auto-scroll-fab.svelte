<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons';
  import type { AutoScroller } from '$lib/components/book-reader/types';
  import { multiplier$ } from '$lib/data/store';
  import { onDestroy } from 'svelte';
  import type { Subscription } from 'rxjs';

  export let autoScroller: AutoScroller | undefined;

  let enabled = false;
  let sub: Subscription | undefined;

  $: {
    sub?.unsubscribe();
    sub = autoScroller?.wasAutoScrollerEnabled$.subscribe((v) => (enabled = v));
  }

  onDestroy(() => sub?.unsubscribe());

  function toggle() {
    autoScroller?.toggle();
  }
</script>

{#if autoScroller}
  <button
    type="button"
    title={enabled ? '暂停自动阅读 (Space)' : '开始自动阅读 (Space) · A/D 调速'}
    on:click={toggle}
    class="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg backdrop-blur"
    class:opacity-90={!enabled}
    class:opacity-100={enabled}
    style="background-color: rgba(95, 126, 123, 0.92); color: #f0efe6;"
  >
    <Fa icon={enabled ? faPause : faPlay} size="lg" />
    <span class="sr-only">{enabled ? '暂停' : '开始'}自动阅读</span>
    <span
      class="absolute -top-2 -right-2 min-w-[1.25rem] rounded-full bg-black/40 px-1 text-[10px] leading-5"
      title="速度倍率 (A 加速 / D 减速)"
    >
      ×{$multiplier$}
    </span>
  </button>
{/if}
