<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';

  export let x = 0;
  export let y = 0;
  export let visible = false;
  export let mode: 'create' | 'edit' = 'create';
  export let hasMemo = false;

  const dispatch = createEventDispatcher<{
    color: HighlightColor;
    memo: void;
    editMemo: void;
    delete: void;
    close: void;
  }>();

  const colors: { id: HighlightColor; bg: string; label: string }[] = [
    { id: 'yellow', bg: 'rgba(255,235,59,0.6)', label: '黄' },
    { id: 'blue', bg: 'rgba(100,181,246,0.5)', label: '蓝' },
    { id: 'green', bg: 'rgba(129,199,132,0.5)', label: '绿' },
    { id: 'pink', bg: 'rgba(244,143,177,0.5)', label: '粉' }
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
    class="fixed z-[81] flex items-center gap-1 rounded-lg px-2 py-1.5 shadow-lg"
    style="left:{menuX}px;top:{menuY}px;background:rgba(43,90,105,0.95);color:#f0efe6;"
  >
    {#if mode === 'create'}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="h-7 w-7 rounded-full border-2 border-transparent hover:border-white/60 transition-colors"
          style="background:{c.bg}"
          title="高亮 ({c.label})"
          on:click={() => handleColor(c.id)}
        />
      {/each}
      <span class="mx-0.5 h-5 w-px bg-white/30" />
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs hover:bg-white/15 transition-colors"
        title="添加备注"
        on:click={() => dispatch('memo')}
      >备注</button>
    {:else}
      {#each colors as c (c.id)}
        <button
          type="button"
          class="h-7 w-7 rounded-full border-2 border-transparent hover:border-white/60 transition-colors"
          style="background:{c.bg}"
          title="改色 ({c.label})"
          on:click={() => handleColor(c.id)}
        />
      {/each}
      <span class="mx-0.5 h-5 w-px bg-white/30" />
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs hover:bg-white/15 transition-colors"
        on:click={() => dispatch('editMemo')}
      >{hasMemo ? '编辑备注' : '添加备注'}</button>
      <button
        type="button"
        class="rounded px-2 py-0.5 text-xs text-red-300 hover:bg-white/15 transition-colors"
        on:click={() => dispatch('delete')}
      >删除</button>
    {/if}
  </div>
{/if}
