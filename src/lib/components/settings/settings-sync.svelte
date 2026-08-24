<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
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
    syncLastError$,
    syncToken$
  } from '$lib/data/store';
  import {
    ensureDeviceId,
    pullNow,
    pushNow,
    startSyncLoop
  } from '$lib/data/sync/sync-manager';
  import { generateToken } from '$lib/data/sync/sync-client';
  import { t, tImmediate } from '$lib/i18n';

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
    if (!ts) return tImmediate('sync.never');
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function applyToken() {
    const next = tokenInput.trim().toLowerCase();
    if (!next) {
      syncToken$.next('');
      message = tImmediate('sync.tokenCleared');
      return;
    }
    if (!/^[0-9a-f]{32}$/.test(next)) {
      message = tImmediate('sync.tokenInvalid');
      return;
    }
    syncToken$.next(next);
    message = tImmediate('sync.saved');
  }

  function genNew() {
    const t = generateToken();
    tokenInput = t;
    syncToken$.next(t);
    message = tImmediate('sync.generated');
  }

  async function copyToken() {
    if (!tokenInput) return;
    try {
      await navigator.clipboard.writeText(tokenInput);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (err: any) {
      message = tImmediate('sync.copyFail', { err: err?.message || err });
    }
  }

  function regenDevice() {
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: tImmediate('sync.regenHeader'),
          dialogMessage: tImmediate('sync.regenConfirm'),
          resolver: (wasCanceled: boolean) => {
            if (wasCanceled) return;
            syncDeviceId$.next('');
            ensureDeviceId();
            message = tImmediate('sync.newDeviceId', { id: $syncDeviceId$ });
          }
        }
      }
    ]);
  }

  async function manualPush() {
    busy = true;
    message = tImmediate('sync.pushing');
    try {
      const res = await pushNow();
      message = res ? tImmediate('sync.pushed', { n: res.pushed }) : tImmediate('sync.notEnabled');
    } catch (err: any) {
      message = tImmediate('sync.pushFail', { err: err?.message || err });
    } finally {
      busy = false;
    }
  }

  async function manualPull() {
    busy = true;
    message = tImmediate('sync.pulling');
    try {
      const remote = await pullNow();
      if (!remote) {
        message = tImmediate('sync.notEnabled');
      } else {
        const bookCount = Object.keys(remote.books || {}).length;
        message = tImmediate('sync.pulled', { n: bookCount });
      }
    } catch (err: any) {
      message = tImmediate('sync.pullFail', { err: err?.message || err });
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
  <p class="mb-3 opacity-70 leading-relaxed">{$t('sync.description')}</p>

  <label class="mb-3 flex items-center gap-2">
    <input type="checkbox" checked={$syncEnabled$} on:change={onEnabledChange} />
    <span>{$t('sync.enable')}</span>
  </label>

  <div class="mb-3 flex items-stretch gap-2">
    <input
      type="text"
      bind:value={tokenInput}
      placeholder={$t('sync.tokenPlaceholder')}
      class="flex-1 rounded border-2 border-current/40 px-2 py-1 text-sm font-mono"
    />
    <button
      class="rounded border-2 border-current/40 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={applyToken}
      disabled={busy}
    >{$t('sync.save')}</button>
    <button
      class="rounded border-2 border-current/40 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={genNew}
      disabled={busy}
    >{$t('sync.generate')}</button>
    <button
      class="rounded border-2 border-current/40 px-3 py-1 text-sm hover:bg-gray-400/10"
      title={$t('sync.copyToken')}
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
    <span>{$t('sync.deviceIdLabel')}<span class="font-mono">{$syncDeviceId$ || $t('sync.deviceIdUnset')}</span></span>
    <button
      class="opacity-60 hover:opacity-100"
      title={$t('sync.regenDeviceId')}
      on:click={regenDevice}
      disabled={busy}
    ><Fa icon={faRotateRight} size="xs" /></button>
  </div>

  <div class="mb-3 flex flex-wrap items-center gap-2">
    <button
      class="flex items-center gap-1 rounded border-2 border-current/40 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={manualPush}
      disabled={busy || !$syncEnabled$ || !$syncToken$}
    ><Fa icon={faUpload} size="xs" /> {$t('sync.pushNow')}</button>
    <button
      class="flex items-center gap-1 rounded border-2 border-current/40 px-3 py-1 text-sm hover:bg-gray-400/10"
      on:click={manualPull}
      disabled={busy || !$syncEnabled$ || !$syncToken$}
    ><Fa icon={faDownload} size="xs" /> {$t('sync.pullNow')}</button>
    <span class="text-xs opacity-60">{$t('sync.lastSync', { time: formatTime($syncLastAt$) })}</span>
  </div>

  {#if $syncLastError$}
    <p class="mb-3 text-xs" style="color:var(--danger-color);">
      {$t('sync.autoFailed', { detail: $syncLastError$ })}
    </p>
  {/if}

  {#if message}
    <p class="text-xs opacity-70">{message}</p>
  {/if}
</div>
