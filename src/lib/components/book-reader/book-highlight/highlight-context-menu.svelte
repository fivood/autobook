<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';
  import { t } from '$lib/i18n';

  export let x = 0;
  export let y = 0;
  export let visible = false;
  export let mode: 'create' | 'edit' = 'create';
  export let hasMemo = false;

  const dispatch = createEventDispatcher<{
    color: HighlightColor;
    memo: void;
    editMemo: void;
    lookup: void;
    delete: void;
    close: void;
  }>();

  const colors: { id: HighlightColor; bg: string; labelKey: string }[] = [
    { id: 'yellow', bg: 'rgba(255,235,59,0.6)', labelKey: 'highlight.color.yellow' },
    { id: 'blue', bg: 'rgba(100,181,246,0.5)', labelKey: 'highlight.color.blue' },
    { id: 'green', bg: 'rgba(129,199,132,0.5)', labelKey: 'highlight.color.green' },
    { id: 'pink', bg: 'rgba(244,143,177,0.5)', labelKey: 'highlight.color.pink' }
  ];

  function handleColor(c: HighlightColor) {
    dispatch('color', c);
  }

  function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  $: menuX = clamp(x, 8, (typeof window !== 'undefined' ? window.innerWidth : 800) - 220);
  $: menuY = clamp(y, 8, (typeof window !== 'undefined' ? window.innerHeight : 600) - 60);
</script>

{#if visible}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="fixed inset-0 z-[80]" on:click={() => dispatch('close')} on:contextmenu|preventDefault={() => dispatch('close')} />
  <div
    class="fixed z-[81] flex items-center gap-1 rounded-lg px-2 py-1.5"
    style="left:{menuX}px;top:{menuY}px;background:var(--menu-background);color:var(--menu-foreground);box-shadow:0 8px 24px rgba(0,0,0,0.35),0 0 0 1px rgba(255,255,255,0.08) inset,0 0 0 1px rgba(0,0,0,0.15);"
  >
    {#if mode === 'create'}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="h-7 w-7 rounded-full border-2 border-transparent hover:border-white/60 transition-colors"
          style="background:{c.bg}"
          title={$t('highlight.color.tooltip', { label: $t(c.labelKey) })}
          on:click={() => handleColor(c.id)}
        />
      {/each}
      <span class="mx-0.5 h-5 w-px bg-white/30" />
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs hover:bg-white/15 transition-colors"
        title={$t('highlight.addMemo')}
        on:click={() => dispatch('memo')}
      >{$t('highlight.memo.short')}</button>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs hover:bg-white/15 transition-colors"
        title={$t('highlight.dict.tooltip')}
        on:click={() => dispatch('lookup')}
      >{$t('highlight.dict.short')}</button>
    {:else}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="h-7 w-7 rounded-full border-2 border-transparent hover:border-white/60 transition-colors"
          style="background:{c.bg}"
          title={$t('highlight.recolor.tooltip', { label: $t(c.labelKey) })}
          on:click={() => handleColor(c.id)}
        />
      {/each}
      <span class="mx-0.5 h-5 w-px bg-white/30" />
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs hover:bg-white/15 transition-colors"
        on:click={() => dispatch('editMemo')}
      >{hasMemo ? $t('highlight.editMemo') : $t('highlight.addMemo')}</button>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs text-red-300 hover:bg-white/15 transition-colors"
        on:click={() => dispatch('delete')}
      >{$t('highlight.delete')}</button>
    {/if}
  </div>
{/if}
