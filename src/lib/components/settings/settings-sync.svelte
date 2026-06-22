<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faRotateRight,
    faUpload,
    faDownload,
    faCheck
  } from '@fortawesome/free-solid-svg-icons';
  import {
    syncDeviceId$,
    syncEnabled$,
    syncLastAt$,
    syncToken$
  } from '$lib/data/store';
  import {
    ensureDeviceId,
    pullNow,
    pushNow,
    startSyncLoop
  } from '$lib/data/sync/sync-manager';
  import { generateToken } from '$lib/data/sync/sync-client';

  let tokenInput = $syncToken$;
  let copied = false;
  let busy = false;
  let message = '';

  $: $syncToken$, (tokenInput = $syncToken$);

  onMount(() => {
    ensureDeviceId();
    if ($syncEnabled$ && $syncToken$) startSyncLoop();
  });

  function formatTime(ts: number): string {
    if (!ts) return '从未';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function applyToken() {
    const next = tokenInput.trim().toLowerCase();
    if (!next) {
      syncToken$.next('');
      message = 'token 已清除';
      return;
    }
    if (!/^[0-9a-f]{32}$/.test(next)) {
      message = 'token 必须是 32 字符 hex';
      return;
    }
    syncToken$.next(next);
    message = '已保存';
  }

  function genNew() {
    const t = generateToken();
    tokenInput = t;
    syncToken$.next(t);
    message = '已生成并保存。把它粘到其它设备即可同步';
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

  function regenDevice() {
    if (!confirm('重新生成 device-id 后，此设备过往天数的统计在云端会被记成新设备的贡献，可能造成总时长虚高。确定？')) return;
    syncDeviceId$.next('');
    ensureDeviceId();
    message = `新 device-id：${$syncDeviceId$}`;
  }

  async function manualPush() {
    busy = true;
    message = '同步中…';
    try {
      const res = await pushNow();
      message = res ? `已推送 ${res.pushed} 条新增/变化` : '当前未启用同步';
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
      if (!remote) {
        message = '当前未启用同步';
      } else {
        const bookCount = Object.keys(remote.books || {}).length;
        message = `已拉取，云端共 ${bookCount} 本书`;
      }
    } catch (err: any) {
      message = `拉取失败：${err?.message || err}`;
    } finally {
      busy = false;
    }
  }

  function onEnabledChange(ev: Event) {
    const next = (ev.currentTarget as HTMLInputElement).checked;
    syncEnabled$.next(next);
    if (next) startSyncLoop();
  }
</script>

<div class="text-sm">
  <p class="mb-3 opacity-70 leading-relaxed">
    跨设备同步阅读时长。32 字符 token 即认证：先在一台设备「生成」，把同一个 token 粘到其它设备就行。
    数据走 <code>sync.fivood.com</code>（Cloudflare Worker + KV）。
  </p>

  <label class="mb-3 flex items-center gap-2">
    <input type="checkbox" checked={$syncEnabled$} on:change={onEnabledChange} />
    <span>启用同步</span>
  </label>

  <div class="mb-3 flex items-stretch gap-2">
    <input
      type="text"
      bind:value={tokenInput}
      placeholder="32 字符 hex token"
      class="flex-1 rounded border-2 border-gray-400 px-2 py-1 text-sm font-mono"
    />
    <button
      class="rounded border-2 border-gray-400 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={applyToken}
      disabled={busy}
    >保存</button>
    <button
      class="rounded border-2 border-gray-400 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={genNew}
      disabled={busy}
    >生成</button>
    <button
      class="rounded border-2 border-gray-400 px-3 py-1 text-sm hover:bg-gray-400/10"
      title="复制 token"
      on:click={copyToken}
      disabled={!tokenInput}
    >
      {#if copied}
        <Fa icon={faCheck} class="text-green-600" />
      {:else}
        <Fa icon={faCopy} />
      {/if}
    </button>
  </div>

  <div class="mb-3 flex items-center gap-3 text-xs opacity-70">
    <span>本机 device-id：<span class="font-mono">{$syncDeviceId$ || '（未生成）'}</span></span>
    <button
      class="opacity-60 hover:opacity-100"
      title="重新生成 device-id"
      on:click={regenDevice}
      disabled={busy}
    ><Fa icon={faRotateRight} size="xs" /></button>
  </div>

  <div class="mb-3 flex flex-wrap items-center gap-2">
    <button
      class="flex items-center gap-1 rounded border-2 border-gray-400 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={manualPush}
      disabled={busy || !$syncEnabled$ || !$syncToken$}
    ><Fa icon={faUpload} size="xs" /> 立刻推送</button>
    <button
      class="flex items-center gap-1 rounded border-2 border-gray-400 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={manualPull}
      disabled={busy || !$syncEnabled$ || !$syncToken$}
    ><Fa icon={faDownload} size="xs" /> 立刻拉取</button>
    <span class="text-xs opacity-60">上次同步：{formatTime($syncLastAt$)}</span>
  </div>

  {#if message}
    <p class="text-xs opacity-70">{message}</p>
  {/if}
</div>
