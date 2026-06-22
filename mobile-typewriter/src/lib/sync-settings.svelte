<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faCheck, faCopy } from '@fortawesome/free-solid-svg-icons';
  import {
    generateToken,
    getDeviceId,
    getLastSyncAt,
    getSyncToken,
    isSyncEnabled,
    isValidToken,
    pullNow,
    pushNow,
    setSyncEnabled,
    setSyncToken,
    startSyncLoop
  } from './stats';

  const dispatch = createEventDispatcher<{ close: void }>();

  let tokenInput = '';
  let enabled = false;
  let device = '';
  let lastAt = 0;
  let copied = false;
  let busy = false;
  let message = '';

  onMount(() => {
    tokenInput = getSyncToken();
    enabled = isSyncEnabled();
    device = getDeviceId();
    lastAt = getLastSyncAt();
  });

  function formatTime(ts: number): string {
    if (!ts) return '从未';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function applyToken() {
    const next = tokenInput.trim().toLowerCase();
    if (next && !isValidToken(next)) {
      message = 'token 必须是 32 字符 hex';
      return;
    }
    setSyncToken(next);
    tokenInput = next;
    message = next ? '已保存' : 'token 已清除';
    if (enabled && next) startSyncLoop();
  }

  function genNew() {
    const t = generateToken();
    tokenInput = t;
    setSyncToken(t);
    message = '已生成。把它粘到桌面端「设置 → 数据 → 同步」即可对接';
    if (enabled) startSyncLoop();
  }

  async function copyToken() {
    if (!tokenInput) return;
    try {
      await navigator.clipboard.writeText(tokenInput);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (err: any) {
      message = `复制失败：${err?.message || err}`;
    }
  }

  function toggleEnabled() {
    enabled = !enabled;
    setSyncEnabled(enabled);
    if (enabled) startSyncLoop();
    message = enabled ? '同步已启用' : '同步已关闭';
  }

  async function manualPush() {
    busy = true;
    message = '推送中…';
    try {
      const res = await pushNow();
      lastAt = getLastSyncAt();
      message = res ? `已推送 ${res.pushed} 条` : '未启用同步';
    } catch (err: any) {
      message = `推送失败：${err?.message || err}`;
    } finally {
      busy = false;
    }
  }

  async function manualPull() {
    busy = true;
    message = '拉取中…';
    try {
      const remote = await pullNow();
      lastAt = getLastSyncAt();
      message = remote
        ? `已拉取，云端共 ${Object.keys(remote.books || {}).length} 本书`
        : '未启用同步';
    } catch (err: any) {
      message = `拉取失败：${err?.message || err}`;
    } finally {
      busy = false;
    }
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="overlay" on:click|self={() => dispatch('close')}>
  <div class="sheet">
    <header>
      <h2>跨设备同步</h2>
      <button on:click={() => dispatch('close')} aria-label="关闭">
        <Fa icon={faTimes} />
      </button>
    </header>

    <p class="lead">
      32 字符 token 是认证。先在桌面端「设置 → 数据 → 同步」生成，把同一串粘进下方；或直接在这里生成、复制到桌面端。
    </p>

    <label class="row">
      <input type="checkbox" checked={enabled} on:change={toggleEnabled} />
      <span>启用同步</span>
    </label>

    <div class="row token-row">
      <input
        type="text"
        bind:value={tokenInput}
        placeholder="32 字符 hex token"
        class="token-input"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
      />
      <button on:click={applyToken}>保存</button>
      <button on:click={genNew}>生成</button>
      <button class="icon" on:click={copyToken} disabled={!tokenInput} aria-label="复制">
        {#if copied}
          <Fa icon={faCheck} />
        {:else}
          <Fa icon={faCopy} />
        {/if}
      </button>
    </div>

    <p class="meta">本机 device-id：<span class="mono">{device || '（未生成）'}</span></p>

    <div class="actions">
      <button on:click={manualPush} disabled={busy || !enabled || !tokenInput}>立刻推送</button>
      <button on:click={manualPull} disabled={busy || !enabled || !tokenInput}>立刻拉取</button>
      <span class="meta">上次：{formatTime(lastAt)}</span>
    </div>

    {#if message}
      <p class="message">{message}</p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .sheet {
    width: 100%;
    max-width: 30rem;
    max-height: 85vh;
    overflow-y: auto;
    border-radius: 1rem 1rem 0 0;
    padding: 1rem 1rem calc(env(safe-area-inset-bottom) + 1rem);
    background: var(--bg);
    color: var(--fg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }
  header h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  header button {
    padding: 0.4rem;
    opacity: 0.7;
  }
  .lead {
    font-size: 0.82rem;
    color: var(--fg-dim);
    margin: 0 0 0.8rem;
    line-height: 1.5;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
    font-size: 0.9rem;
  }
  .token-row {
    flex-wrap: wrap;
  }
  .token-input {
    flex: 1;
    min-width: 10em;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.4rem;
    background: transparent;
    color: inherit;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
  }
  .token-row button {
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .token-row button.icon {
    padding: 0.5rem 0.7rem;
  }
  .meta {
    font-size: 0.75rem;
    color: var(--fg-dim);
    margin: 0;
  }
  .mono {
    font-family: ui-monospace, monospace;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.8rem 0 0.4rem;
  }
  .actions button {
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .message {
    margin: 0.6rem 0 0;
    font-size: 0.78rem;
    color: var(--fg-dim);
  }
</style>
