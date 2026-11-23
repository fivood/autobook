<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { onDestroy, tick } from 'svelte';
  import TextSourceEditor from '$lib/components/text-editor/text-source-editor.svelte';
  import { getFormattedElementMd } from '$lib/functions/file-loaders/md/generate-md-html';
  import { isTauri } from '$lib/data/env';
  import { editFilePath$ } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { goBack } from '$lib/functions/back-nav';
  import { t, tImmediate } from '$lib/i18n';

  /**
   * Edits a Markdown file opened from Explorer in place. Nothing here touches
   * the library: the file on disk is the only copy, and Ctrl+S writes it back.
   * The fs scope already allows exactly this path — Rust whitelists every
   * launch argument (`allow_paths`) — and nothing else.
   *
   * Opens on the rendered note, like Obsidian's reading view; 编辑 (or
   * Ctrl/⌘+E) swaps in the plain source, set in the same font.
   */

  let path = '';
  let value = '';
  /** Editor text as last loaded or saved, to tell whether there are edits. */
  let saved = '';
  /** File content exactly as last read or written, CRLF and all. */
  let diskText = '';
  let crlf = false;
  let loadError = '';
  let saving = false;
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let editor: TextSourceEditor;
  let mode: 'read' | 'edit' = 'read';
  let readEl: HTMLDivElement | undefined;

  /** An action held back by unsaved edits, waiting on the inline confirm. */
  let pending: { message: string; confirmLabel: string; run: () => void } | undefined;
  let leaving = false;

  $: name = path.split(/[\\/]/).pop() || '';
  $: dirty = !loadError && value !== saved;
  // Rendered only while reading; the sanitizer runs inside getFormattedElementMd.
  $: rendered =
    mode === 'read' && value.trim() ? getFormattedElementMd(value).element.innerHTML : '';

  const subscription = editFilePath$.subscribe((next) => {
    if (!next || next === path) return;
    if (dirty) {
      pending = {
        message: tImmediate('fileEditor.openOtherConfirm', { name: next.split(/[\\/]/).pop() || next }),
        confirmLabel: tImmediate('fileEditor.discard'),
        run: () => load(next)
      };
    } else {
      load(next);
    }
  });
  onDestroy(() => {
    subscription.unsubscribe();
    if (noticeTimer) clearTimeout(noticeTimer);
  });

  beforeNavigate((nav) => {
    if (!dirty || leaving || !nav.to) return;
    nav.cancel();
    const target = nav.to.url;
    pending = {
      message: tImmediate('fileEditor.leaveConfirm'),
      confirmLabel: tImmediate('fileEditor.discard'),
      run: () => {
        leaving = true;
        // ← is a history back; replaying it as goto would push a new entry
        // and leave this page sitting behind it.
        if (nav.type === 'popstate') history.back();
        else goto(target);
      }
    };
  });

  async function load(next: string) {
    pending = undefined;
    path = next;
    loadError = '';
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const text = await readTextFile(next);
      diskText = text;
      crlf = text.includes('\r\n');
      // A textarea hands back LF only. Normalize here and restore the file's
      // own line endings on save, or the first save rewrites every line.
      value = saved = text.replace(/\r\n/g, '\n');
      // Nothing to read in an empty note: start where the typing happens.
      mode = value.trim() ? 'read' : 'edit';
      await tick();
      if (mode === 'edit') editor?.focus();
    } catch (err: any) {
      value = saved = diskText = '';
      loadError = tImmediate('fileEditor.loadFailed', { error: err?.message || String(err) });
    }
  }

  function flash(message: string) {
    notice = message;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 2000);
  }

  async function save(force = false) {
    // Not `dirty`: that reactive copy lags a tick behind `value`, so a save
    // fired in the same tick as the last keystroke would see nothing to save.
    if (!path || saving || loadError || value === saved) return;
    saving = true;
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      // Another program may have written the file since it was opened here.
      // Overwriting that silently would lose its changes, so ask first.
      if (!force) {
        const current = await readTextFile(path).catch(() => null);
        if (current !== null && current !== diskText) {
          pending = {
            message: tImmediate('fileEditor.changedOnDisk'),
            confirmLabel: tImmediate('fileEditor.overwrite'),
            run: () => save(true)
          };
          return;
        }
      }
      const out = crlf ? value.replace(/\n/g, '\r\n') : value;
      await writeTextFile(path, out);
      diskText = out;
      saved = value;
      pending = undefined;
      flash(tImmediate('fileEditor.saved'));
    } catch (err: any) {
      flash(tImmediate('fileEditor.saveFailed', { error: err?.message || String(err) }));
    } finally {
      saving = false;
    }
  }

  async function toggleMode() {
    if (loadError || !path) return;
    mode = mode === 'read' ? 'edit' : 'read';
    // The editor mounts with the mode change; it isn't bound until then.
    await tick();
    if (mode === 'edit') editor?.focus();
  }

  /**
   * Links in the rendered note must not navigate this window: an in-page
   * anchor (footnotes) would trip the unsaved-changes guard as a navigation,
   * and a relative link to another note has nothing here to open. Web links go
   * to the system browser.
   */
  async function onReadClick(e: MouseEvent) {
    const a = (e.target as Element | null)?.closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    e.preventDefault();
    if (href.startsWith('#')) {
      readEl?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: 'start' });
    } else if (/^https?:/i.test(href)) {
      if (isTauri()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(href).catch(() => undefined);
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    }
  }

  function confirmPending() {
    const action = pending;
    pending = undefined;
    action?.run();
  }
</script>

<!-- The textarea handles its own Ctrl+S (and marks it handled); this catches
     the rest — the reading view has no textarea at all. -->
<svelte:window
  on:keydown={(e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      save();
    } else if (key === 'e') {
      e.preventDefault();
      toggleMode();
    }
  }}
/>

<svelte:head>
  <title>{formatPageTitle(name ? `${dirty ? '● ' : ''}${name}` : $t('fileEditor.title'))}</title>
</svelte:head>

<div
  class="flex h-screen flex-col"
  style="color:var(--font-color);background:var(--background-color);"
>
  <div class="flex items-center gap-3 border-b border-current/15 px-4 py-2">
    <button
      type="button"
      class="menu-choice"
      title={$t('menu.back.title')}
      on:click={goBack}
    >←</button>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium" title={path}>
        {#if dirty}<span title={$t('fileEditor.unsaved')}>● </span>{/if}{name || $t('fileEditor.title')}
      </div>
      {#if path}<div class="truncate text-xs opacity-50" title={path}>{path}</div>{/if}
    </div>
    {#if notice}<span class="text-sm opacity-70">{notice}</span>{/if}
    {#if path && !loadError}
      <button
        type="button"
        class="menu-choice"
        title={$t(mode === 'read' ? 'fileEditor.editHint' : 'fileEditor.readHint')}
        on:click={toggleMode}
      >{$t(mode === 'read' ? 'fileEditor.edit' : 'fileEditor.read')}</button>
    {/if}
    <button
      type="button"
      class="menu-choice menu-choice-active min-w-[5rem]"
      disabled={!dirty || saving}
      title={$t('fileEditor.saveHint')}
      on:click={() => save()}
    >{saving ? $t('fileEditor.saving') : $t('fileEditor.save')}</button>
  </div>

  {#if pending}
    <div class="flex flex-wrap items-center gap-2 border-b border-current/15 px-4 py-2 text-sm">
      <span class="flex-1" style="color:var(--danger-color);">{pending.message}</span>
      <button type="button" class="menu-choice" on:click={() => (pending = undefined)}>
        {$t('fileEditor.keepEditing')}
      </button>
      <button type="button" class="menu-choice" on:click={confirmPending}>{pending.confirmLabel}</button>
    </div>
  {/if}

  <div class="min-h-0 flex-1">
    {#if !path}
      <p class="p-4 opacity-60">{$t('fileEditor.noFile')}</p>
    {:else if loadError}
      <p class="p-4" style="color:var(--danger-color);">{loadError}</p>
    {:else if mode === 'read'}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="h-full overflow-y-auto" on:click={onReadClick}>
        <div class="md-read" bind:this={readEl}>{@html rendered}</div>
      </div>
    {:else}
      <TextSourceEditor
        bind:this={editor}
        bind:value
        format="markdown"
        fill
        bare
        on:saveShortcut={() => save()}
      />
    {/if}
  </div>
</div>

<style>
  /* Same column and type as the editor's bare surface, so switching between
     reading and editing doesn't move or restyle the text: a 46rem text column
     plus this padding's 1.5rem each side. */
  .md-read {
    max-width: 49rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    font-size: 1rem;
    line-height: 1.75;
  }
</style>
