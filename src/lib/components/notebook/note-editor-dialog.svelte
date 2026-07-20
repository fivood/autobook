<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';
  import { t } from '$lib/i18n';
  import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_DOT as colorDot } from '$lib/data/highlight-color';

  export let mode: 'create' | 'edit' = 'create';
  export let memo = '';
  export let tags: string[] = [];
  export let color: HighlightColor = 'yellow';

  const dispatch = createEventDispatcher<{
    save: { memo: string; tags: string[]; color: HighlightColor };
    cancel: void;
  }>();

  const DRAFT_KEY = 'notebook:note-draft';

  marked.setOptions({ breaks: true, gfm: true });

  let value = memo;
  let tagsInput = tags.join(' ');
  let selectedColor = color;
  let preview = false;
  let restoredFromDraft = false;
  let textareaEl: HTMLTextAreaElement | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    if (mode === 'create' && typeof localStorage !== 'undefined') {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        value = draft;
        restoredFromDraft = true;
      }
    }
    tick().then(() => textareaEl?.focus());
  });

  function persistDraft() {
    if (mode !== 'create' || typeof localStorage === 'undefined') return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(DRAFT_KEY, value), 400);
  }

  function clearDraft() {
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

  $: charCount = value.length;
  $: previewHtml = preview ? (marked.parse(value || '') as string) : '';
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40"
  on:click|self={close}
>
  <div
    class="w-full max-w-lg rounded-lg p-4 shadow-xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
  >
    <div class="mb-3 flex items-center justify-between">
      <h3 class="text-base font-medium">
        {mode === 'create' ? $t('notebook.editor.new') : $t('notebook.editor.edit')}
      </h3>
      <div class="flex items-center gap-1 rounded border border-current/20 p-0.5 text-xs">
        <button
          type="button"
          class="rounded px-2 py-0.5"
          class:bg-current-10={!preview}
          on:click={() => (preview = false)}
        >{$t('notebook.edit')}</button>
        <button
          type="button"
          class="rounded px-2 py-0.5"
          class:bg-current-10={preview}
          on:click={() => (preview = true)}
        >{$t('notebook.editor.preview')}</button>
      </div>
    </div>

    {#if restoredFromDraft}
      <div class="mb-2 flex items-center justify-between rounded border border-current/10 bg-current/5 px-3 py-1.5 text-xs opacity-70">
        <span>{$t('notebook.editor.draftRestored')}</span>
        <button
          type="button"
          class="hover:text-red-500"
          on:click={discardDraft}
        >{$t('notebook.editor.discard')}</button>
      </div>
    {/if}

    {#if preview}
      <div class="nb-preview max-h-[50vh] min-h-[12rem] overflow-y-auto rounded border border-current/20 p-3 text-sm">
        {#if value.trim()}
          {@html previewHtml}
        {:else}
          <p class="opacity-40">{$t('notebook.editor.noPreview')}</p>
        {/if}
      </div>
    {:else}
      <textarea
        bind:this={textareaEl}
        bind:value
        on:input={persistDraft}
        on:keydown={handleKeydown}
        class="w-full rounded border border-current/20 bg-transparent p-2 text-sm"
        style="min-height:12rem;resize:vertical;"
        placeholder={$t('notebook.editor.placeholder')}
      />
    {/if}

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
        style="background:rgba(95,126,123,0.9);color:#f0efe6;"
        on:click={commit}
      >{$t('notebook.editor.save')}</button>
    </div>
  </div>
</div>

<style>
  :global(.nb-preview h1) { font-size: 1.2em; font-weight: 600; margin: 0.5em 0 0.3em; }
  :global(.nb-preview h2) { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.3em; }
  :global(.nb-preview h3) { font-size: 1em; font-weight: 600; margin: 0.5em 0 0.3em; }
  :global(.nb-preview p) { margin: 0.4em 0; line-height: 1.6; }
  :global(.nb-preview ul), :global(.nb-preview ol) { margin: 0.4em 0; padding-left: 1.4em; }
  :global(.nb-preview li) { margin: 0.15em 0; }
  :global(.nb-preview code) { background: rgba(127,127,127,0.15); padding: 0 3px; border-radius: 3px; font-size: 0.9em; }
  :global(.nb-preview pre) { background: rgba(127,127,127,0.12); padding: 0.6em; border-radius: 4px; overflow-x: auto; margin: 0.5em 0; }
  :global(.nb-preview blockquote) { border-left: 3px solid currentColor; opacity: 0.7; padding-left: 0.8em; margin: 0.5em 0; }
  :global(.nb-preview a) { color: inherit; text-decoration: underline; }
</style>
