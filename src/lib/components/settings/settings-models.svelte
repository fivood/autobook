<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faSpinner, faDownload, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { MODELS, isOcrDownloaded, ocrDownloadProgress$ } from '$lib/data/models-registry';
  import { kokoroLoadStatus$, kokoroModel$, type KokoroModelId } from '$lib/data/store';
  import { t, tImmediate } from '$lib/i18n';

  interface ModelStatus {
    ready: boolean;
    checking: boolean;
    progress?: { loaded: number; total: number; message: string };
  }

  // A record keyed by model id, held in a writable store so `statuses.set()`
  // (a fresh object each time) actually triggers re-render — mutating a Map
  // does not, which left the list stuck on "checking…".
  const statuses = writable<Record<string, ModelStatus>>({});

  async function refresh(modelId: string) {
    statuses.update((s) => ({ ...s, [modelId]: { ready: false, checking: true } }));
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return;
    try {
      const ready = await model.ready();
      statuses.update((s) => ({ ...s, [modelId]: { ready, checking: false } }));
    } catch {
      statuses.update((s) => ({ ...s, [modelId]: { ready: false, checking: false } }));
    }
  }

  onMount(() => {
    for (const m of MODELS) refresh(m.id);
    // Keep Kokoro download progress live.
    subscriptions.push(
      kokoroLoadStatus$.subscribe((s) => {
        if (s?.phase === 'loading') {
          statuses.update((all) => ({
            ...all,
            'tts-kokoro': {
              ready: false,
              checking: false,
              progress: { loaded: s.loaded, total: s.total, message: s.message }
            }
          }));
        } else if (s?.phase === 'ready') {
          statuses.update((all) => ({ ...all, 'tts-kokoro': { ready: true, checking: false } }));
        }
      })
    );
    // Keep PaddleOCR download progress live (det + rec tarballs).
    subscriptions.push(
      ocrDownloadProgress$.subscribe((p) => {
        if (!p.downloading) {
          statuses.update((all) => ({ ...all, 'ocr-paddle': { ready: isOcrDownloaded(), checking: false } }));
          return;
        }
        const loaded = p.files.reduce((s, f) => s + f.loaded, 0);
        const total = p.files.reduce((s, f) => s + f.total, 0);
        const msg = p.files.map((f) => `${f.name}: ${fmtBytes(f.loaded)}`).join(' + ');
        statuses.update((all) => ({
          ...all,
          'ocr-paddle': { ready: false, checking: false, progress: { loaded, total, message: msg } }
        }));
      })
    );
  });

  const subscriptions: Array<(() => void) | { unsubscribe: () => void }> = [];

  onDestroy(() => {
    for (const sub of subscriptions) {
      if (typeof sub === 'function') sub();
      else sub.unsubscribe();
    }
    subscriptions.length = 0;
  });

  function fmtBytes(n: number): string {
    if (!n) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  async function uninstall(modelId: string) {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model?.uninstall) return;
    const ok = confirm(tImmediate('models.confirmUninstall', { name: tImmediate(model.nameKey) }));
    if (!ok) return;
    const id = model.id === 'tts-kokoro' ? (kokoroModel$.getValue() as KokoroModelId) : undefined;
    const done = await model.uninstall(id);
    if (done) await refresh(modelId);
  }
</script>

<div class="space-y-3">
  <h4 class="font-medium">{$t('models.heading')}</h4>
  <p class="mb-2 text-sm opacity-70">{$t('models.description')}</p>

  {#each MODELS as model}
    {@const st = $statuses[model.id]}
    <div class="rounded border border-current/20 bg-current/5 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="font-medium">{$t(model.nameKey)}</div>
          <div class="text-xs opacity-60">{$t(model.purposeKey)}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          {#if st?.checking}
            <Fa icon={faSpinner} spin class="opacity-60" />
            <span class="text-xs opacity-60">{$t('models.checking')}</span>
          {:else if st?.progress}
            <Fa icon={faDownload} class="opacity-70" />
            <span class="text-xs tabular-nums opacity-80">
              {st.progress.message || fmtBytes(st.progress.loaded)}
            </span>
          {:else}
            <span
              class="rounded-full px-2 py-0.5 text-xs"
              style="background:{st?.ready ? 'rgba(90,190,120,0.25)' : 'rgba(220,150,60,0.25)'};color:var(--font-color);"
            >
              {st ? (st.ready ? $t('models.ready') : $t('models.notReady')) : $t('models.checking')}
            </span>
          {/if}
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-70">
        <span>📍 {model.location}</span>
        <span>{model.size}</span>
        {#if model.uninstall}
          <button
            class="ml-auto rounded border border-current/30 px-2 py-0.5 hover-soft disabled:opacity-50"
            disabled={!st?.ready}
            on:click={() => uninstall(model.id)}
            title={$t('models.uninstallTitle')}
          >
            <Fa icon={faTrash} size="xs" /> {$t('models.uninstall')}
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>
