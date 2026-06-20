<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let memo = '';
  export let selectedText = '';
  export let tags: string[] = [];

  const dispatch = createEventDispatcher<{
    save: { memo: string; tags: string[] };
    cancel: void;
  }>();

  let value = memo;
  let tagsInput = tags.join(' ');
  let textareaEl: HTMLTextAreaElement;

  onMount(() => {
    textareaEl?.focus();
  });

  function parseTags(s: string): string[] {
    return Array.from(
      new Set(
        s
          .split(/[\s,，]+/)
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean)
      )
    );
  }

  function commit() {
    dispatch('save', { memo: value, tags: parseTags(tagsInput) });
  }

  function handleKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      dispatch('cancel');
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      commit();
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
    <input
      type="text"
      bind:value={tagsInput}
      class="mt-2 w-full rounded border border-current/20 bg-transparent px-2 py-1.5 text-sm"
      placeholder="标签，空格或逗号分隔（如 写作 叙事 结构）"
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
        on:click={commit}
      >保存 (Ctrl+Enter)</button>
    </div>
  </div>
</div>
