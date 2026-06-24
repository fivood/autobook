<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faFolderOpen, faTrash, faRotateRight } from '@fortawesome/free-solid-svg-icons';
  import { isTauri } from '$lib/data/env';

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
      message = `读取路径失败：${err?.message || err}`;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function copyPath(p: string) {
    try {
      await navigator.clipboard.writeText(p);
      message = '已复制到剪贴板';
      setTimeout(() => (message = ''), 1500);
    } catch (err: any) {
      message = `复制失败：${err?.message || err}`;
    }
  }

  async function openInExplorer(p: string) {
    if (!isTauri()) return;
    busy = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_data_folder', { path: p });
    } catch (err: any) {
      message = `打开失败：${err?.message || err}`;
    } finally {
      busy = false;
    }
  }

  async function clearAll() {
    if (
      !confirm(
        '⚠ 即将清除全部本地数据：\n\n' +
          '• 所有书籍内容\n' +
          '• 所有高亮 / 笔记本 / 标签 / 文件夹\n' +
          '• 阅读统计 / 阅读时长 / 完成记录\n' +
          '• 所有 UI 设置 / 主题 / 同步 token / API key\n\n' +
          '此操作不可恢复。Documents/AutoBook 文件夹里同步过的副本不会被删，但 IndexedDB 主存储会彻底清空。继续？'
      )
    )
      return;
    if (!confirm('再确认一次：真的要清空吗？')) return;
    busy = true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('schedule_full_reset');
    } catch (err: any) {
      message = `清除失败：${err?.message || err}`;
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
  <p class="opacity-70 text-sm">桌面端可用。</p>
{:else if loading}
  <p class="opacity-70 text-sm">读取中…</p>
{:else if paths}
  <div class="text-sm">
    <div class="grid">
      <div class="row">
        <div class="label">书库 + 高亮 + 笔记本 + 统计</div>
        <div class="meta">IndexedDB · {formatBytes(paths.indexeddbBytes)} · {paths.indexeddbDirs.length} profile</div>
        {#each paths.indexeddbDirs as p (p)}
          <div class="path-row">
            <code class="path" title={p}>{p}</code>
            <button class="btn icon" on:click={() => copyPath(p)} title="复制路径">复制</button>
            <button class="btn icon" on:click={() => openInExplorer(p)} disabled={busy} title="在资源管理器打开"><Fa icon={faFolderOpen} size="xs" /></button>
          </div>
        {/each}
        <p class="hint">主存储。受 WebView2 管理，无法直接搬迁。备份请用上方「跨设备同步」推阅读统计，单本可用 FS 同步</p>
      </div>

      <div class="row">
        <div class="label">UI 设置 / token / API key</div>
        <div class="meta">localStorage · WebView2 用户目录</div>
        {#each paths.localStorageDirs as p (p)}
          <div class="path-row">
            <code class="path" title={p}>{p}</code>
            <button class="btn icon" on:click={() => copyPath(p)} title="复制路径">复制</button>
            <button class="btn icon" on:click={() => openInExplorer(p)} disabled={busy} title="在资源管理器打开"><Fa icon={faFolderOpen} size="xs" /></button>
          </div>
        {/each}
        <p class="hint">「数据 → 重置 UI 设置」可单独清此处，不影响书库</p>
      </div>

      <div class="row">
        <div class="label">本地 FS 同步副本</div>
        <div class="meta">Documents/AutoBook/ · {paths.documentsExists ? formatBytes(paths.documentsBytes) : '目录还未创建'}</div>
        <div class="path-row">
          <code class="path" title={paths?.documentsRoot}>{paths?.documentsRoot}</code>
          <button class="btn icon" on:click={() => paths && copyPath(paths.documentsRoot)} title="复制路径">复制</button>
          <button class="btn icon" on:click={() => paths && openInExplorer(paths.documentsRoot)} disabled={busy} title="在资源管理器打开"><Fa icon={faFolderOpen} size="xs" /></button>
        </div>
        <p class="hint">仅启用「FS 同步」后写到这里。默认书库在 IndexedDB，不会自动同步</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn" on:click={load} disabled={busy} title="重新读取大小">
        <Fa icon={faRotateRight} size="xs" /> 刷新
      </button>
      <button class="btn danger" on:click={clearAll} disabled={busy}>
        <Fa icon={faTrash} size="xs" /> 清除全部本地数据并重启
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
