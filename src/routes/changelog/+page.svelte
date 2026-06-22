<script lang="ts">
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faTriangleExclamation,
    faRotateLeft
  } from '@fortawesome/free-solid-svg-icons';
  import { pagePath } from '$lib/data/env';
  import { isTauri } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import rawChangelog from '../../../CHANGELOG.md?raw';

  interface Section {
    version: string;
    items: string[];
    callouts: string[];
  }

  const sections: Section[] = parse(rawChangelog as string);

  function parse(md: string): Section[] {
    const lines = md.split(/\r?\n/);
    const out: Section[] = [];
    let current: Section | undefined;
    for (const line of lines) {
      const verMatch = /^## +(.+?)\s*$/.exec(line);
      if (verMatch) {
        current = { version: verMatch[1], items: [], callouts: [] };
        out.push(current);
        continue;
      }
      if (!current) continue;
      const calloutMatch = /^\s*>\s*(?:⚠\s*)?(.+?)\s*$/.exec(line);
      if (calloutMatch) {
        current.callouts.push(calloutMatch[1]);
        continue;
      }
      const itemMatch = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (itemMatch) {
        current.items.push(itemMatch[1]);
      }
    }
    return out;
  }

  let activeIdx = 0;
  let resetting = false;
  let mainEl: HTMLElement | undefined;

  function selectVersion(i: number) {
    activeIdx = i;
    if (mainEl) mainEl.scrollTop = 0;
  }

  async function performReset() {
    if (
      typeof window === 'undefined' ||
      !confirm(
        '将清除本地保存的 UI 设置（主题、字体、自定义快捷键、TTS 引擎选项等），书库与统计数据保留。应用会自动重启。\n\n继续吗？'
      )
    ) {
      return;
    }
    resetting = true;
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('schedule_ui_reset');
        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[changelog] reset failed, falling back to in-page clear:', err);
      }
    }
    const toClear: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) toClear.push(k);
    }
    toClear.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  }

  function needsResetButton(callouts: string[]): boolean {
    return callouts.some((c) => /重置|reset/i.test(c));
  }

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
    }
  }
</script>

<svelte:head>
  <title>{formatPageTitle('更新历史')}</title>
</svelte:head>

<div class="flex h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="flex flex-shrink-0 items-center gap-4 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <button
      type="button"
      class="relative z-20 rounded p-2 hover:bg-black/5"
      title="返回"
      on:click={handleBack}
    ><Fa icon={faArrowLeft} /></button>
    <h1 class="text-xl font-medium">更新历史</h1>
    <span class="text-sm opacity-50">共 {sections.length} 个版本</span>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <aside class="flex w-40 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-current/10 p-3 text-sm">
      {#each sections as s, i (s.version)}
        <button
          type="button"
          class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-black/5"
          style:font-weight={activeIdx === i ? '600' : '400'}
          style:opacity={activeIdx === i ? 1 : 0.7}
          on:click={() => selectVersion(i)}
        >
          <span>v{s.version}</span>
          {#if s.callouts.length}
            <Fa icon={faTriangleExclamation} size="xs" class="text-amber-500" />
          {/if}
        </button>
      {/each}
    </aside>

    <main bind:this={mainEl} class="w-full max-w-3xl flex-1 overflow-y-auto px-6 py-6">
      {#if !sections.length}
        <p class="py-12 text-center opacity-50">CHANGELOG 为空</p>
      {:else}
        {@const current = sections[activeIdx]}
        <h2 class="mb-4 text-2xl font-medium">v{current.version}</h2>
        {#if current.callouts.length}
          <div class="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <div class="mb-2 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
              <Fa icon={faTriangleExclamation} /> 注意事项
            </div>
            <ul class="space-y-1">
              {#each current.callouts as c (c)}
                <li class="leading-relaxed">{c}</li>
              {/each}
            </ul>
            {#if needsResetButton(current.callouts)}
              <button
                type="button"
                class="mt-3 flex items-center gap-2 rounded border border-amber-500/60 px-3 py-1.5 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-50"
                disabled={resetting}
                on:click={performReset}
              ><Fa icon={faRotateLeft} size="xs" /> {resetting ? '正在重置…' : '立即重置 UI 并重启'}</button>
            {/if}
          </div>
        {/if}
        <ul class="space-y-2">
          {#each current.items as item, i (i)}
            <li class="flex gap-2 text-sm leading-relaxed">
              <span class="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full opacity-50" style="background:currentColor;" />
              <span class="flex-1">{item}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
</div>
