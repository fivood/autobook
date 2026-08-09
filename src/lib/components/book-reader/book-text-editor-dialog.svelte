<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t } from '$lib/i18n';
  import TextSourceEditor from '$lib/components/text-editor/text-source-editor.svelte';
  import type { EditableTextFormat } from '$lib/functions/file-loaders/text-source';

  export let bookTitle = '';
  export let source = '';
  export let originalSource: string | undefined;
  export let format: EditableTextFormat = 'markdown';
  export let recoveredFromHtml = false;
  export let saving = false;

  const dispatch = createEventDispatcher<{
    save: { source: string };
    cancel: void;
  }>();

  let value = source;
  let editor: TextSourceEditor;

  $: changed = value !== source;
  $: charCount = Array.from(value).length;

  onMount(() => {
    tick().then(() => editor?.focus());
  });

  function close() {
    if (!saving) dispatch('cancel');
  }

  function save() {
    if (!saving) dispatch('save', { source: value });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-3" on:click|self={close}>
  <div
    class="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg shadow-2xl"
    style="background:var(--background-color,#fff);color:var(--font-color,#333);"
    role="dialog"
    aria-modal="true"
    aria-label={$t('bookEditor.title', { title: bookTitle })}
  >
    <div class="flex items-center justify-between gap-3 border-b border-current/15 px-4 py-3">
      <div class="min-w-0">
        <h2 class="truncate text-base font-medium">{$t('bookEditor.title', { title: bookTitle })}</h2>
        <p class="mt-0.5 text-xs opacity-60">
          {format === 'markdown' ? 'Markdown' : 'TXT'} · {$t('textEditor.chars', { n: charCount })}
        </p>
      </div>
      <button type="button" class="menu-choice" disabled={saving} on:click={close}>
        {$t('bookEditor.close')}
      </button>
    </div>

    {#if recoveredFromHtml}
      <div class="mx-4 mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        {$t('bookEditor.recoveredWarning')}
      </div>
    {/if}
    <div class="mx-4 mt-3 text-xs opacity-60">{$t('bookEditor.positionWarning')}</div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <TextSourceEditor
        bind:this={editor}
        bind:value
        {format}
        minHeight="28rem"
        outlineInitiallyOpen={format === 'markdown'}
        placeholder={$t(format === 'markdown' ? 'bookEditor.markdownPlaceholder' : 'bookEditor.textPlaceholder')}
        on:saveShortcut={save}
        on:escape={close}
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-current/15 px-4 py-3">
      <div>
        {#if originalSource !== undefined}
          <button
            type="button"
            class="menu-choice"
            disabled={saving || value === originalSource}
            on:click={() => (value = originalSource || '')}
          >{$t('bookEditor.restoreOriginal')}</button>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="menu-choice" disabled={saving} on:click={close}>
          {$t('bookEditor.cancel')}
        </button>
        <button
          type="button"
          class="menu-choice menu-choice-active min-w-[6rem]"
          disabled={saving || !changed}
          on:click={save}
        >{saving ? $t('bookEditor.saving') : $t('bookEditor.save')}</button>
      </div>
    </div>
  </div>
</div>
