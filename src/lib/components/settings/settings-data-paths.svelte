<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faFolderOpen, faTrash, faRotateRight } from '@fortawesome/free-solid-svg-icons';
  import { isTauri } from '$lib/data/env';
  import { t, tImmediate } from '$lib/i18n';

  interface DataPaths {
    webviewRoot: string;
    localStorageDirs: string[];
    indexeddbDirs: string[];
    indexeddbBytes: number;
    documentsRoot: string;
    documentsBytes: number;
    documentsExists: boolean;
  }

  let paths: DataPaths | undefined;
  let loading = true;
  let message = '';
  let busy = false;

  async function load() {
    if (!isTauri()) {
      loading = false;
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      paths = (await invoke('get_data_paths')) as DataPaths;
    } catch (err: any) {
      message = tImmediate('dataPaths.readFail', { err: err?.message || err });
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function copyPath(p: string) {
    try {
      await navigator.clipboard.writeText(p);
      message = tImmediate('dataPaths.copied');
      setTimeout(() => (message = ''), 1500);
    } catch (err: any) {
      message = tImmediate('dataPaths.copyFail', { err: err?.message || err });
    }
  }

  async function openInExplorer(p: string) {
    if (!isTauri()) return;
    busy = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_data_folder', { path: p });
    } catch (err: any) {
      message = tImmediate('dataPaths.openFail', { err: err?.message || err });
    } finally {
      busy = false;
    }
  }

  async function clearAll() {
    if (!confirm(tImmediate('dataPaths.clearConfirm'))) return;
    if (!confirm(tImmediate('dataPaths.clearConfirmAgain'))) return;
    busy = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('schedule_full_reset');
    } catch (err: any) {
      message = tImmediate('dataPaths.clearFail', { err: err?.message || err });
      busy = false;
    }
  }

  function formatBytes(b: number): string {
    if (!b) return '0';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
</script>

{#if !isTauri()}
  <p class="opacity-70 text-sm">{$t('dataPaths.desktopOnly')}</p>
{:else if loading}
  <p class="opacity-70 text-sm">{$t('dataPaths.loading')}</p>
{:else if paths}
  <div class="text-sm">
    <div class="grid">
      <div class="row">
        <div class="label">{$t('dataPaths.section.library.label')}</div>
        <div class="meta">{$t('dataPaths.meta.idb', { size: formatBytes(paths.indexeddbBytes), n: paths.indexeddbDirs.length })}</div>
        {#each paths.indexeddbDirs as p (p)}
          <div class="path-row">
            <code class="path" title={p}>{p}</code>
            <button class="btn icon" on:click={() => copyPath(p)} title={$t('dataPaths.copyPath')}>{$t('dataPaths.copy')}</button>
            <button class="btn icon" on:click={() => openInExplorer(p)} disabled={busy} title={$t('dataPaths.openInExplorer')}><Fa icon={faFolderOpen} size="xs" /></button>
          </div>
        {/each}
        <p class="hint">{$t('dataPaths.section.library.hint')}</p>
      </div>

      <div class="row">
        <div class="label">{$t('dataPaths.section.ui.label')}</div>
        <div class="meta">{$t('dataPaths.meta.localStorage')}</div>
        {#each paths.localStorageDirs as p (p)}
          <div class="path-row">
            <code class="path" title={p}>{p}</code>
            <button class="btn icon" on:click={() => copyPath(p)} title={$t('dataPaths.copyPath')}>{$t('dataPaths.copy')}</button>
            <button class="btn icon" on:click={() => openInExplorer(p)} disabled={busy} title={$t('dataPaths.openInExplorer')}><Fa icon={faFolderOpen} size="xs" /></button>
          </div>
        {/each}
        <p class="hint">{$t('dataPaths.section.ui.hint')}</p>
      </div>

      <div class="row">
        <div class="label">{$t('dataPaths.section.fs.label')}</div>
        <div class="meta">{$t('dataPaths.meta.fs', { status: paths.documentsExists ? formatBytes(paths.documentsBytes) : $t('dataPaths.section.fs.notCreated') })}</div>
        <div class="path-row">
          <code class="path" title={paths?.documentsRoot}>{paths?.documentsRoot}</code>
          <button class="btn icon" on:click={() => paths && copyPath(paths.documentsRoot)} title={$t('dataPaths.copyPath')}>{$t('dataPaths.copy')}</button>
          <button class="btn icon" on:click={() => paths && openInExplorer(paths.documentsRoot)} disabled={busy} title={$t('dataPaths.openInExplorer')}><Fa icon={faFolderOpen} size="xs" /></button>
        </div>
        <p class="hint">{$t('dataPaths.section.fs.hint')}</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn" on:click={load} disabled={busy} title={$t('dataPaths.refreshTooltip')}>
        <Fa icon={faRotateRight} size="xs" /> {$t('dataPaths.refresh')}
      </button>
      <button class="btn danger" on:click={clearAll} disabled={busy}>
        <Fa icon={faTrash} size="xs" /> {$t('dataPaths.clearAll')}
      </button>
      {#if message}
        <span class="message">{message}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  @media (min-width: 1024px) {
    .grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .row {
    display: flex;
    flex-direction: column;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--fg-dim, currentColor);
    border-radius: 0.5rem;
    background: rgba(127, 127, 127, 0.05);
    min-width: 0;
  }
  .label {
    font-weight: 600;
    margin-bottom: 0.15rem;
  }
  .meta {
    font-size: 0.7rem;
    opacity: 0.65;
    margin-bottom: 0.45rem;
  }
  .path-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.25rem;
    min-width: 0;
  }
  .path {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    padding: 0.25rem 0.4rem;
    background: rgba(127, 127, 127, 0.12);
    border-radius: 0.3rem;
  }
  .btn {
    flex: 0 0 auto;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--fg-dim, currentColor);
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: rgba(127, 127, 127, 0.1);
  }
  .btn.icon {
    padding: 0.25rem 0.45rem;
    font-size: 0.7rem;
  }
  .btn.danger {
    color: #c64a4a;
    border-color: #c64a4a;
  }
  .btn.danger:hover:not(:disabled) {
    background: rgba(198, 74, 74, 0.1);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.85rem;
  }
  .message {
    font-size: 0.72rem;
    opacity: 0.7;
  }
  .hint {
    font-size: 0.68rem;
    opacity: 0.6;
    margin: 0.45rem 0 0;
    line-height: 1.5;
  }
</style>
