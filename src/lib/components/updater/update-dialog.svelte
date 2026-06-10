<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { createEventDispatcher } from 'svelte';
  import type { UpdateInfo, ProgressEvent } from '$lib/functions/updater/check-for-update';
  import { relaunchApp } from '$lib/functions/updater/check-for-update';

  export let update: UpdateInfo;

  const dispatch = createEventDispatcher<{ close: void }>();

  type Phase = 'idle' | 'downloading' | 'installing' | 'done' | 'error';

  let phase: Phase = 'idle';
  let downloaded = 0;
  let total = 0;
  let errorMessage = '';

  $: percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  $: downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
  $: totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';

  async function startUpdate() {
    phase = 'downloading';
    errorMessage = '';
    try {
      await update.downloadAndInstall((evt: ProgressEvent) => {
        if (evt.event === 'Started') {
          total = evt.total;
          downloaded = 0;
        } else if (evt.event === 'Progress') {
          downloaded = evt.downloaded;
        } else if (evt.event === 'Finished') {
          phase = 'installing';
        }
      });
      phase = 'done';
      await relaunchApp();
    } catch (err: any) {
      phase = 'error';
      errorMessage = err?.message ?? String(err);
    }
  }

  function close() {
    if (phase === 'downloading' || phase === 'installing') return;
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">发现新版本 {update.version}</svelte:fragment>
  <svelte:fragment slot="content">
    <div class="space-y-3 max-w-lg">
      <p class="text-sm opacity-80">
        当前版本 <span class="font-sans">{update.currentVersion}</span> → 新版本 <span class="font-sans">{update.version}</span>
      </p>

      {#if update.notes}
        <div class="border-t pt-2">
          <p class="font-medium mb-1">更新内容</p>
          <div class="font-sans whitespace-pre-wrap text-sm opacity-90 max-h-56 overflow-y-auto">{update.notes}</div>
        </div>
      {/if}

      {#if phase === 'downloading'}
        <div class="border-t pt-2">
          <div class="flex justify-between text-sm mb-1">
            <span>正在下载…</span>
            <span>{downloadedMB} / {totalMB} MB ({percent}%)</span>
          </div>
          <div
            class="h-2 rounded overflow-hidden"
            style="background-color: color-mix(in srgb, currentColor 15%, transparent);"
          >
            <div class="h-full bg-current transition-[width]" style="width: {percent}%"></div>
          </div>
        </div>
      {:else if phase === 'installing'}
        <p class="border-t pt-2 text-sm">正在安装，应用稍后会自动重启…</p>
      {:else if phase === 'done'}
        <p class="border-t pt-2 text-sm">安装完成，正在重启…</p>
      {:else if phase === 'error'}
        <div class="border-t pt-2 text-sm text-red-600">
          <p class="font-medium">更新失败</p>
          <div class="font-sans whitespace-pre-wrap mt-1">{errorMessage}</div>
        </div>
      {/if}
    </div>
  </svelte:fragment>
  <div class="flex grow justify-between" slot="footer">
    <button
      class={buttonClasses}
      class:invisible={phase === 'downloading' || phase === 'installing'}
      on:click={close}
    >
      {phase === 'error' ? '关闭' : '稍后'}
      <Ripple />
    </button>
    {#if phase === 'idle' || phase === 'error'}
      <button class={buttonClasses} on:click={startUpdate}>
        {phase === 'error' ? '重试' : '立即更新'}
        <Ripple />
      </button>
    {/if}
  </div>
</DialogTemplate>
