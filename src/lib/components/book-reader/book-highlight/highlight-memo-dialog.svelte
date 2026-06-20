<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let memo = '';
  export let selectedText = '';

  const dispatch = createEventDispatcher<{ save: string; cancel: void }>();

  let value = memo;
  let textareaEl: HTMLTextAreaElement;

  onMount(() => {
    textareaEl?.focus();
  });

  function handleKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      dispatch('cancel');
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      dispatch('save', value);
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40"
  on:click|self={() => dispatch('cancel')}
>
  <div
    class="w-full max-w-md rounded-lg p-4 shadow-xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
  >
    {#if selectedText}
      <p class="mb-3 rounded bg-black/5 px-3 py-2 text-sm italic line-clamp-3">
        "{selectedText.slice(0, 200)}{selectedText.length > 200 ? '…' : ''}"
      </p>
    {/if}
    <textarea
      bind:this={textareaEl}
      bind:value
      class="w-full rounded border border-current/20 bg-transparent p-2 text-sm"
      style="min-height:6rem;resize:vertical;"
      placeholder="写点备注…"
      on:keydown={handleKeydown}
    />
    <div class="mt-3 flex justify-end gap-2">
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm opacity-70 hover:opacity-100"
        on:click={() => dispatch('cancel')}
      >取消</button>
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm font-medium"
        style="background:rgba(95,126,123,0.9);color:#f0efe6;"
        on:click={() => dispatch('save', value)}
      >保存 (Ctrl+Enter)</button>
    </div>
  </div>
</div>
