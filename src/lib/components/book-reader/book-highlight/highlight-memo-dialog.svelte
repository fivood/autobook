<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from '$lib/i18n';

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
      <p class="mb-3 rounded bg-soft-active px-3 py-2 text-sm italic line-clamp-3">
        "{selectedText.slice(0, 200)}{selectedText.length > 200 ? '…' : ''}"
      </p>
    {/if}
    <textarea
      bind:this={textareaEl}
      bind:value
      class="w-full rounded border border-current/20 bg-transparent p-2 text-sm"
      style="min-height:6rem;resize:vertical;"
      placeholder={$t('highlight.memo.placeholder')}
      on:keydown={handleKeydown}
    />
    <input
      type="text"
      bind:value={tagsInput}
      class="mt-2 w-full rounded border border-current/20 bg-transparent px-2 py-1.5 text-sm"
      placeholder={$t('highlight.memo.tagsPlaceholder')}
      on:keydown={handleKeydown}
    />
    <div class="mt-3 flex justify-end gap-2">
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm opacity-70 hover:opacity-100"
        on:click={() => dispatch('cancel')}
      >{$t('dialog.cancel')}</button>
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm font-medium"
        style="background:var(--menu-background);color:var(--menu-foreground);"
        on:click={commit}
      >{$t('highlight.memo.save')}</button>
    </div>
  </div>
</div>
