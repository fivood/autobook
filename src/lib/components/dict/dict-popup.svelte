<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
  import { isTauri } from '$lib/data/env';
  import { dictFolderPath$ } from '$lib/data/store';
  import { lookupAll, scanDictFolder, loadedDicts$ } from '$lib/data/dict/dict-manager';
  import { t, tImmediate } from '$lib/i18n';

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
      message = tImmediate('dict.loadingFirst');
      try {
        const res = await scanDictFolder($dictFolderPath$);
        message =
          res.loaded.length || res.errors.length
            ? res.errors.length
              ? tImmediate('dict.loadedWithErrors', { n: res.loaded.length, e: res.errors.length })
              : tImmediate('dict.loaded', { n: res.loaded.length })
            : '';
        if (res.errors.length) {
          console.warn('[dict] errors', res.errors);
        }
      } catch (err: any) {
        message = tImmediate('dict.loadFailed', { err: err?.message || err });
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
      message = tImmediate('dict.notFound', { word, n: loaded.length });
    } else if (!loaded.length) {
      message = tImmediate('dict.notConfigured');
    } else {
      message = '';
    }
  }

  async function pickAndLoad() {
    if (!isTauri()) {
      alert(tImmediate('dict.desktopOnly'));
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: tImmediate('dict.pickFolder') });
    if (typeof picked !== 'string') return;
    dictFolderPath$.next(picked);
    busy = true;
    message = tImmediate('dict.scanning');
    try {
      const res = await scanDictFolder(picked);
      message = res.errors.length
        ? tImmediate('dict.scanDoneWithErrors', { n: res.loaded.length, e: res.errors.length })
        : tImmediate('dict.scanDone', { n: res.loaded.length });
      if (res.errors.length) {
        console.warn('[dict] errors', res.errors);
      }
    } catch (err: any) {
      message = tImmediate('dict.scanFailed', { err: err?.message || err });
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
    <span class="text-xs opacity-50">{$t('dict.count', { n: loaded.length })}</span>
    <div class="flex-1" />
    <button
      type="button"
      class="rounded p-1 opacity-60 hover:bg-black/5 hover:opacity-100"
      title={$t('dict.pickFolderTooltip')}
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
        <p>{$t('dict.emptyLine1')}</p>
        <p class="mt-1 text-xs opacity-60">{$t('dict.emptyLine2')}</p>
        <p class="mt-3 text-xs opacity-50">{$t('dict.emptyLine3')}</p>
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
