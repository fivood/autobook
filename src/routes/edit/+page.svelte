<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import TextSourceEditor from '$lib/components/text-editor/text-source-editor.svelte';
  import { pagePath } from '$lib/data/env';
  import { editFilePath$ } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { t, tImmediate } from '$lib/i18n';

  /**
   * Edits a Markdown file opened from Explorer in place. Nothing here touches
   * the library: the file on disk is the only copy, and Ctrl+S writes it back.
   * The fs scope already allows exactly this path — Rust whitelists every
   * launch argument (`allow_paths`) — and nothing else.
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

  /** An action held back by unsaved edits, waiting on the inline confirm. */
  let pending: { message: string; confirmLabel: string; run: () => void } | undefined;
  let leaving = false;

  $: name = path.split(/[\\/]/).pop() || '';
  $: dirty = !loadError && value !== saved;

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
        goto(target);
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
      editor?.focus();
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

  function confirmPending() {
    const action = pending;
    pending = undefined;
    action?.run();
  }
</script>

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
      title={$t('fileEditor.backToLibrary')}
      on:click={() => goto(`${pagePath}/manage`)}
    >←</button>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium" title={path}>
        {#if dirty}<span title={$t('fileEditor.unsaved')}>● </span>{/if}{name || $t('fileEditor.title')}
      </div>
      {#if path}<div class="truncate text-xs opacity-50" title={path}>{path}</div>{/if}
    </div>
    {#if notice}<span class="text-sm opacity-70">{notice}</span>{/if}
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

  <div class="min-h-0 flex-1 p-2">
    {#if !path}
      <p class="p-4 opacity-60">{$t('fileEditor.noFile')}</p>
    {:else if loadError}
      <p class="p-4" style="color:var(--danger-color);">{loadError}</p>
    {:else}
      <TextSourceEditor
        bind:this={editor}
        bind:value
        format="markdown"
        fill
        initialView="split"
        on:saveShortcut={() => save()}
      />
    {/if}
  </div>
</div>
