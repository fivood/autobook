<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
  import { isTauri } from '$lib/data/env';
  import { dictFolderPath$ } from '$lib/data/store';
  import { lookupAll, scanDictFolder, loadedDicts$ } from '$lib/data/dict/dict-manager';

  export let word: string;
  export let x = 0;
  export let y = 0;

  const dispatch = createEventDispatcher<{ close: void }>();

  let results: { dict: string; entries: string[] }[] = [];
  let loaded = $loadedDicts$;
  let busy = false;
  let message = '';

  onMount(async () => {
    if (!loaded.length && $dictFolderPath$ && isTauri()) {
      busy = true;
      message = '首次载入词典中…';
      try {
        const res = await scanDictFolder($dictFolderPath$);
        message =
          res.loaded.length || res.errors.length
            ? `已载入 ${res.loaded.length} 个词典${res.errors.length ? `，${res.errors.length} 出错` : ''}`
            : '';
        if (res.errors.length) {
          console.warn('[dict] errors', res.errors);
        }
      } catch (err: any) {
        message = `加载失败：${err?.message || err}`;
      } finally {
        busy = false;
      }
    }
    refresh();
  });

  $: if (word) refresh();

  loadedDicts$.subscribe((v) => {
    loaded = v;
    refresh();
  });

  function refresh() {
    if (!word) {
      results = [];
      return;
    }
    results = lookupAll(word);
    if (!results.length && loaded.length) {
      message = `「${word}」未在已载入的 ${loaded.length} 个词典中找到`;
    } else if (!loaded.length) {
      message = '未配置词典';
    } else {
      message = '';
    }
  }

  async function pickAndLoad() {
    if (!isTauri()) {
      alert('词典加载只在桌面端可用');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: '选择词典文件夹（含 StarDict 子目录或 .dict.json 文件）' });
    if (typeof picked !== 'string') return;
    dictFolderPath$.next(picked);
    busy = true;
    message = '扫描中…';
    try {
      const res = await scanDictFolder(picked);
      message = `已载入 ${res.loaded.length} 个词典${res.errors.length ? `，${res.errors.length} 个出错` : ''}`;
      if (res.errors.length) {
        console.warn('[dict] errors', res.errors);
      }
    } catch (err: any) {
      message = `扫描失败：${err?.message || err}`;
    } finally {
      busy = false;
    }
  }

  function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  const POPUP_W = 380;
  const POPUP_H_EST = 320;
  $: popX = clamp(x, 8, (typeof window !== 'undefined' ? window.innerWidth : 800) - POPUP_W - 8);
  $: popY = clamp(y, 8, (typeof window !== 'undefined' ? window.innerHeight : 600) - POPUP_H_EST - 8);

  function stripHtml(s: string): string {
    // many StarDict packs store HTML in m/h types; strip naively for readability
    return s.replace(/<br\s*\/?>(?!\s*$)/gi, '\n').replace(/<[^>]+>/g, '');
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="fixed inset-0 z-[80]" on:click|self={() => dispatch('close')} />
<div
  class="fixed z-[81] flex max-h-[60vh] w-[380px] flex-col rounded-lg border border-current/20 shadow-2xl"
  style="left:{popX}px;top:{popY}px;background:var(--background-color,#fff);color:var(--font-color,#333);"
>
  <div class="flex items-center gap-2 border-b border-current/10 px-3 py-2">
    <span class="truncate text-base font-medium">{word}</span>
    <span class="text-xs opacity-50">{loaded.length} 词典</span>
    <div class="flex-1" />
    <button
      type="button"
      class="rounded p-1 opacity-60 hover:bg-black/5 hover:opacity-100"
      title="选择词典文件夹"
      on:click={pickAndLoad}
      disabled={busy}
    ><Fa icon={faFolderOpen} size="xs" /></button>
    <button
      type="button"
      class="rounded p-1 opacity-60 hover:bg-black/5 hover:opacity-100"
      on:click={() => dispatch('close')}
    ><Fa icon={faTimes} size="xs" /></button>
  </div>

  <div class="flex-1 overflow-y-auto px-3 py-2 text-sm">
    {#if !loaded.length}
      <div class="py-4 text-center text-sm opacity-70">
        <p>还没有载入词典。</p>
        <p class="mt-1 text-xs opacity-60">点上方📂选择一个文件夹。支持 StarDict（.ifo + .idx + .dict[.dz]）以及 *.dict.json。</p>
        <p class="mt-3 text-xs opacity-50">可在 kaifa.baidu / SourceForge / GitHub 上找到 ECDICT / CC-CEDICT / JMdict 等 StarDict 包。</p>
      </div>
    {:else if !results.length}
      <p class="py-4 text-center text-sm opacity-50">{message || '未找到'}</p>
    {:else}
      {#each results as r (r.dict)}
        <section class="mb-3">
          <h4 class="mb-1 text-xs font-medium opacity-50">{r.dict}</h4>
          {#each r.entries as entry, i (i)}
            <p class="whitespace-pre-wrap break-words leading-relaxed">{stripHtml(entry)}</p>
          {/each}
        </section>
      {/each}
    {/if}
    {#if message && loaded.length && results.length}
      <p class="mt-2 text-xs opacity-50">{message}</p>
    {/if}
  </div>
</div>
