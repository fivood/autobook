<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
  import { HIGHLIGHT_SLOTS } from '$lib/data/highlight-color';
  import HighlightSlotSwatch from '$lib/components/highlight-slot-swatch.svelte';
  import { t } from '$lib/i18n';

  export let x = 0;
  export let y = 0;
  export let visible = false;
  export let mode: 'create' | 'edit' = 'create';
  export let hasMemo = false;

  const dispatch = createEventDispatcher<{
    color: HighlightSlot;
    memo: void;
    editMemo: void;
    lookup: void;
    startHere: void;
    delete: void;
    close: void;
  }>();

  const colors = HIGHLIGHT_SLOTS.map((id) => ({ id, label: id }));

  function handleColor(c: HighlightSlot) {
    dispatch('color', c);
  }

  function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  // Measured rather than assumed: the toolbar's width depends on how many
  // items this mode shows and on how long they are in the active locale, and
  // the old hardcoded 220 already understated it.
  let menuWidth = 220;

  $: menuX = clamp(x, 8, (typeof window !== 'undefined' ? window.innerWidth : 800) - menuWidth - 8);
  $: menuY = clamp(y, 8, (typeof window !== 'undefined' ? window.innerHeight : 600) - 60);
</script>

{#if visible}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="fixed inset-0 z-[80]" on:click={() => dispatch('close')} on:contextmenu|preventDefault={() => dispatch('close')} />
  <div
    class="menu-surface menu-toolbar fixed z-[81] w-max"
    style="left:{menuX}px;top:{menuY}px;"
    bind:clientWidth={menuWidth}
  >
    {#if mode === 'create'}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="rounded-full border-2 border-transparent p-0.5 transition-colors hover:border-current/60"
          title={$t('highlight.slot.tooltip', { label: c.label })}
          on:click={() => handleColor(c.id)}
        ><HighlightSlotSwatch slot={c.id} class="h-6 w-6 text-[0.7rem]" /></button>
      {/each}
      <span class="menu-divider" />
      <button
        type="button"
        class="menu-item menu-item-inline"
        title={$t('highlight.addMemo')}
        on:click={() => dispatch('memo')}
      >{$t('highlight.memo.short')}</button>
      <button
        type="button"
        class="menu-item menu-item-inline"
        title={$t('highlight.dict.tooltip')}
        on:click={() => dispatch('lookup')}
      >{$t('highlight.dict.short')}</button>
      <button
        type="button"
        class="menu-item menu-item-inline"
        title={$t('highlight.startHere.tooltip')}
        on:click={() => dispatch('startHere')}
      >{$t('highlight.startHere.short')}</button>
    {:else}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="rounded-full border-2 border-transparent p-0.5 transition-colors hover:border-current/60"
          title={$t('highlight.recolor.tooltip', { label: c.label })}
          on:click={() => handleColor(c.id)}
        ><HighlightSlotSwatch slot={c.id} class="h-6 w-6 text-[0.7rem]" /></button>
      {/each}
      <span class="menu-divider" />
      <button
        type="button"
        class="menu-item menu-item-inline"
        on:click={() => dispatch('editMemo')}
      >{hasMemo ? $t('highlight.editMemo') : $t('highlight.addMemo')}</button>
      <button
        type="button"
        class="menu-item menu-item-inline menu-item-danger"
        on:click={() => dispatch('delete')}
      >{$t('highlight.delete')}</button>
    {/if}
  </div>
{/if}
