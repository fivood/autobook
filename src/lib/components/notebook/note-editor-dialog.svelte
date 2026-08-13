<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';
  import { t } from '$lib/i18n';
  import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_DOT as colorDot } from '$lib/data/highlight-color';
  import TextSourceEditor from '$lib/components/text-editor/text-source-editor.svelte';

  export let mode: 'create' | 'edit' = 'create';
  export let memo = '';
  export let tags: string[] = [];
  export let color: HighlightColor = 'yellow';

  const dispatch = createEventDispatcher<{
    save: { memo: string; tags: string[]; color: HighlightColor };
    cancel: void;
  }>();

  const DRAFT_KEY = 'notebook:note-draft';

  let value = memo;
  let tagsInput = tags.join(' ');
  let selectedColor = color;
  let restoredFromDraft = false;
  let editor: TextSourceEditor;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    if (mode === 'create' && typeof localStorage !== 'undefined') {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        value = draft;
        restoredFromDraft = true;
      }
    }
    tick().then(() => editor?.focus());
  });

  function persistDraft() {
    if (mode !== 'create' || typeof localStorage === 'undefined') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(DRAFT_KEY, value), 400);
  }

  function clearDraft() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DRAFT_KEY);
    restoredFromDraft = false;
  }

  function discardDraft() {
    clearDraft();
    value = '';
  }

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
    dispatch('save', { memo: value, tags: parseTags(tagsInput), color: selectedColor });
    clearDraft();
  }

  function close() {
    dispatch('cancel');
  }

  function handleKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      close();
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      commit();
    }
  }

  $: charCount = Array.from(value).length;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40"
  on:click|self={close}
>
  <div
    class="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-lg p-4 shadow-xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
  >
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-base font-medium">
        {mode === 'create' ? $t('notebook.editor.new') : $t('notebook.editor.edit')}
      </h3>
    </div>

    {#if restoredFromDraft}
      <div class="mb-2 flex items-center justify-between rounded border border-current/10 bg-current/5 px-3 py-1.5 text-xs opacity-70">
        <span>{$t('notebook.editor.draftRestored')}</span>
        <button
          type="button"
          class="hover-danger"
          on:click={discardDraft}
        >{$t('notebook.editor.discard')}</button>
      </div>
    {/if}

    <TextSourceEditor
      bind:this={editor}
      bind:value
      format="markdown"
      minHeight="18rem"
      placeholder={$t('notebook.editor.placeholder')}
      on:change={persistDraft}
      on:saveShortcut={commit}
      on:escape={close}
    />

    <div class="mt-2 flex items-center justify-between text-xs">
      <div class="flex items-center gap-1.5 opacity-70">
        <span>{$t('notebook.editor.color')}</span>
        {#each HIGHLIGHT_COLORS as c (c)}
          <button
            type="button"
            class="rounded-full p-0.5"
            class:ring-2={selectedColor === c}
            class:ring-current={selectedColor === c}
            title={c}
            on:click={() => (selectedColor = c)}
          ><span class="inline-block h-4 w-4 rounded-full" style="background:{colorDot[c]}" /></button>
        {/each}
      </div>
      <span class="opacity-50">{$t('notebook.editor.chars', { n: charCount })}</span>
    </div>

    <input
      type="text"
      bind:value={tagsInput}
      class="mt-2 w-full rounded border border-current/20 bg-transparent px-2 py-1.5 text-sm"
      placeholder={$t('notebook.editor.tagsPlaceholder')}
      on:keydown={handleKeydown}
    />

    <div class="mt-3 flex justify-end gap-2">
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm opacity-70 hover:opacity-100"
        on:click={close}
      >{$t('notebook.editor.cancel')}</button>
      <button
        type="button"
        class="rounded px-4 py-1.5 text-sm font-medium"
        style="background:var(--menu-background);color:var(--menu-foreground);"
        on:click={commit}
      >{$t('notebook.editor.save')}</button>
    </div>
  </div>
</div>
