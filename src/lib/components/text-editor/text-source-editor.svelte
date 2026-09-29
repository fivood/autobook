<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { getFormattedElementMd } from '$lib/functions/file-loaders/md/generate-md-html';
  import type { EditableTextFormat } from '$lib/functions/file-loaders/text-source';

  type EditorView = 'edit' | 'split' | 'preview';
  interface OutlineItem {
    level: number;
    label: string;
    offset: number;
    headingIndex: number;
  }

  export let value = '';
  export let format: EditableTextFormat = 'markdown';
  export let placeholder = '';
  export let initialView: EditorView = 'edit';
  export let minHeight = '20rem';
  export let outlineInitiallyOpen = false;

  const dispatch = createEventDispatcher<{
    change: { value: string };
    saveShortcut: void;
    escape: void;
  }>();

  let viewMode: EditorView = initialView;
  let outlineOpen = outlineInitiallyOpen;
  let previewHtml = '';
  let previewError = '';
  let textareaEl: HTMLTextAreaElement | undefined;
  let previewEl: HTMLDivElement | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;

  $: outline = format === 'markdown' ? extractOutline(value) : [];
  $: if (browser && format === 'markdown' && viewMode !== 'edit') {
    queuePreview(value);
  }

  onDestroy(() => {
    if (renderTimer) clearTimeout(renderTimer);
  });

  export function focus() {
    tick().then(() => textareaEl?.focus());
  }

  function queuePreview(source: string) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderPreview(source), 180);
  }

  function renderPreview(source: string) {
    try {
      previewHtml = source.trim() ? getFormattedElementMd(source).element.innerHTML : '';
      previewError = '';
    } catch (error: any) {
      previewHtml = '';
      previewError = error?.message || String(error);
    }
  }

  function switchView(next: EditorView) {
    viewMode = next;
    if (next !== 'edit') renderPreview(value);
    if (next !== 'preview') focus();
  }

  function handleInput() {
    dispatch('change', { value });
    if (format === 'markdown' && viewMode !== 'edit') queuePreview(value);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      dispatch('escape');
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      dispatch('saveShortcut');
    }
  }

  async function jumpToHeading(item: OutlineItem) {
    if (viewMode === 'edit') {
      textareaEl?.focus();
      textareaEl?.setSelectionRange(item.offset, item.offset);
      const line = value.slice(0, item.offset).split('\n').length - 1;
      if (textareaEl) {
        const lineHeight = Number.parseFloat(getComputedStyle(textareaEl).lineHeight) || 22;
        textareaEl.scrollTop = Math.max(0, line * lineHeight - textareaEl.clientHeight / 3);
      }
      return;
    }

    await tick();
    const heading = previewEl?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')[item.headingIndex];
    if (heading && previewEl) {
      previewEl.scrollTo({ top: Math.max(0, heading.offsetTop - 12), behavior: 'smooth' });
    }
  }

  function extractOutline(source: string): OutlineItem[] {
    const items: OutlineItem[] = [];
    const lines = source.split(/\n/);
    let offset = 0;
    let inFence = false;

    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
      } else if (!inFence) {
        const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (match) {
          items.push({
            level: match[1].length,
            label: match[2].trim(),
            offset,
            headingIndex: items.length
          });
        }
      }
      offset += line.length + 1;
    }
    return items;
  }
</script>

<div class="text-source-editor overflow-hidden rounded-lg border border-current/20">
  {#if format === 'markdown'}
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-current/15 p-2">
      <div class="menu-toolbar p-0">
        <button
          type="button"
          class="menu-choice"
          class:menu-choice-active={viewMode === 'edit'}
          aria-pressed={viewMode === 'edit'}
          on:click={() => switchView('edit')}
        >{$t('textEditor.edit')}</button>
        <button
          type="button"
          class="menu-choice hidden sm:block"
          class:menu-choice-active={viewMode === 'split'}
          aria-pressed={viewMode === 'split'}
          on:click={() => switchView('split')}
        >{$t('textEditor.split')}</button>
        <button
          type="button"
          class="menu-choice"
          class:menu-choice-active={viewMode === 'preview'}
          aria-pressed={viewMode === 'preview'}
          on:click={() => switchView('preview')}
        >{$t('textEditor.preview')}</button>
      </div>
      <button
        type="button"
        class="menu-choice"
        class:menu-choice-active={outlineOpen}
        aria-pressed={outlineOpen}
        on:click={() => (outlineOpen = !outlineOpen)}
      >{$t('textEditor.outline')}</button>
    </div>
  {/if}

  <div class="editor-layout" class:outline-open={format === 'markdown' && outlineOpen}>
    {#if format === 'markdown' && outlineOpen}
      <aside class="outline-panel overflow-y-auto border-r border-current/15 p-2" style:min-height={minHeight}>
        {#if outline.length}
          {#each outline as item (item.offset)}
            <button
              type="button"
              class="block w-full truncate rounded py-1 pr-2 text-left text-sm hover:bg-current/10"
              style:padding-left={`${0.5 + (item.level - 1) * 0.65}rem`}
              title={item.label}
              on:click={() => jumpToHeading(item)}
            >{item.label}</button>
          {/each}
        {:else}
          <div class="p-2 text-sm opacity-50">{$t('textEditor.noOutline')}</div>
        {/if}
      </aside>
    {/if}

    <div class="content-layout" class:split={format === 'markdown' && viewMode === 'split'}>
      {#if viewMode !== 'preview' || format === 'text'}
        <textarea
          bind:this={textareaEl}
          bind:value
          class="source-area min-w-0 resize-none bg-transparent p-3 font-mono text-sm leading-relaxed outline-none"
          style:min-height={minHeight}
          {placeholder}
          spellcheck="true"
          on:input={handleInput}
          on:keydown={handleKeydown}
        />
      {/if}

      {#if format === 'markdown' && viewMode !== 'edit'}
        <div
          bind:this={previewEl}
          class="text-editor-preview min-w-0 overflow-y-auto p-4 text-sm"
          class:split-divider={viewMode === 'split'}
          style:min-height={minHeight}
          style:max-height={`calc(${minHeight} + 12rem)`}
        >
          {#if previewError}
            <p class="text-danger">{previewError}</p>
          {:else if previewHtml}
            {@html previewHtml}
          {:else}
            <p class="opacity-40">{$t('textEditor.noPreview')}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .editor-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .editor-layout.outline-open {
    grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr);
  }
  .content-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  .content-layout.split {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .source-area {
    width: 100%;
  }
  .split-divider {
    border-left: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
  :global(.text-editor-preview .md-section) { margin-bottom: 1.2em; }
  :global(.text-editor-preview h1) { font-size: 1.6em; }
  :global(.text-editor-preview h2) { font-size: 1.35em; }
  :global(.text-editor-preview h3) { font-size: 1.18em; }
  :global(.text-editor-preview h1),
  :global(.text-editor-preview h2),
  :global(.text-editor-preview h3),
  :global(.text-editor-preview h4),
  :global(.text-editor-preview h5),
  :global(.text-editor-preview h6) {
    margin: 0.8em 0 0.35em;
    font-weight: 600;
    line-height: 1.3;
  }
  :global(.text-editor-preview p) { margin: 0.5em 0; line-height: 1.65; }
  :global(.text-editor-preview ul),
  :global(.text-editor-preview ol) { margin: 0.5em 0; padding-left: 1.5em; }
  :global(.text-editor-preview li) { margin: 0.2em 0; }
  :global(.text-editor-preview code:not(.hljs)) {
    border-radius: 0.2rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    padding: 0.08em 0.3em;
  }
  :global(.text-editor-preview pre) {
    overflow-x: auto;
    border-radius: 0.35rem;
    background: rgba(0, 0, 0, 0.5);
    padding: 0.75rem;
  }
  :global(.text-editor-preview blockquote) {
    margin: 0.6em 0;
    border-left: 3px solid currentColor;
    padding-left: 0.9em;
    opacity: 0.75;
  }
  :global(.text-editor-preview table) { border-collapse: collapse; }
  :global(.text-editor-preview th),
  :global(.text-editor-preview td) { border: 1px solid currentColor; padding: 0.35em 0.6em; }

  @media (max-width: 640px) {
    .editor-layout.outline-open {
      grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr);
    }
    .content-layout.split {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
