<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { t } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';
  import type { UpdateInfo, ProgressEvent } from '$lib/functions/updater/check-for-update';
  import { relaunchApp } from '$lib/functions/updater/check-for-update';
  import { submitReport } from '$lib/functions/report-error';
  import { marked } from 'marked';
  import { sanitizeHtml } from '$lib/functions/sanitize-html';

  marked.setOptions({ breaks: true, gfm: true });

  // marked passes raw HTML in the source straight through, and these notes
  // arrive over the network from the update server, so they get the same
  // treatment as book content before hitting `{@html}`.
  function renderMd(text: string): string {
    return sanitizeHtml(marked.parse(text || '') as string);
  }

  export let update: UpdateInfo;

  const dispatch = createEventDispatcher<{ close: void }>();

  type Phase = 'idle' | 'downloading' | 'installing' | 'done' | 'error';
  type ChangelogEntry = { version: string; notes: string; pub_date: string };

  let phase: Phase = 'idle';
  let downloaded = 0;
  let total = 0;
  let errorMessage = '';
  let aggregated: ChangelogEntry[] = [];

  /** Strict SemVer-ish compare; returns -1 | 0 | 1. Pre-release tags ignored. */
  function cmp(a: string, b: string): number {
    const pa = a.replace(/[^0-9.].*$/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/[^0-9.].*$/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  onMount(async () => {
    // Pull the multi-version changelog from the same Worker that serves
    // latest.json so users updating across several versions see every
    // intermediate release's notes. Best-effort: silently fall back to the
    // single update.notes string the updater already gave us.
    try {
      const resp = await fetch('https://updates.fivood.com/changelog', { cache: 'no-store' });
      if (!resp.ok) return;
      const all = (await resp.json()) as ChangelogEntry[];
      aggregated = all
        .filter(
          (entry) =>
            entry.version &&
            cmp(entry.version, update.currentVersion) > 0 &&
            cmp(entry.version, update.version) <= 0
        )
        .sort((a, b) => cmp(b.version, a.version));
    } catch {
      // network or worker failure — fall back to update.notes
    }
  });

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
      // Best-effort telemetry: let the operator know when auto-updates fail
      // in the wild (installer locks, network, signature issues, etc.).
      submitReport({
        type: 'update',
        message: errorMessage,
        currentVersion: update.currentVersion,
        targetVersion: update.version,
        context: { name: err?.name, code: err?.code }
      }).catch(() => {
        /* silent: we already show the error in the dialog */
      });
    }
  }

  function close() {
    if (phase === 'downloading' || phase === 'installing') return;
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t('update.header', { version: update.version })}</svelte:fragment>
  <svelte:fragment slot="content">
    <div class="space-y-3 max-w-lg">
      <p class="text-sm opacity-80">
        {$t('update.currentToNew', { current: update.currentVersion, target: update.version })}
      </p>

      {#if aggregated.length > 1}
        <div class="border-t pt-2">
          <p class="font-medium mb-1">{$t('update.changelog.multi', { count: aggregated.length })}</p>
          <div class="max-h-56 overflow-y-auto space-y-3">
            {#each aggregated as entry (entry.version)}
              <div>
                <h4 class="font-medium text-sm">v{entry.version}</h4>
                <div class="release-notes font-sans text-sm opacity-90 mt-1">{@html renderMd(entry.notes)}</div>
              </div>
            {/each}
          </div>
        </div>
      {:else if update.notes}
        <div class="border-t pt-2">
          <p class="font-medium mb-1">{$t('update.changelog.single')}</p>
          <div class="release-notes font-sans text-sm opacity-90 max-h-56 overflow-y-auto">{@html renderMd(update.notes)}</div>
        </div>
      {/if}

      {#if phase === 'downloading'}
        <div class="border-t pt-2">
          <div class="flex justify-between text-sm mb-1">
            <span>{$t('update.downloading')}</span>
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
        <p class="border-t pt-2 text-sm">{$t('update.installing')}</p>
      {:else if phase === 'done'}
        <p class="border-t pt-2 text-sm">{$t('update.done')}</p>
      {:else if phase === 'error'}
        <div class="border-t pt-2 text-sm text-danger">
          <p class="font-medium">{$t('update.failed')}</p>
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
      {phase === 'error' ? $t('dialog.close') : $t('update.later')}
      <Ripple />
    </button>
    {#if phase === 'idle' || phase === 'error'}
      <button class={buttonClasses} on:click={startUpdate}>
        {phase === 'error' ? $t('update.retry') : $t('update.installNow')}
        <Ripple />
      </button>
    {/if}
  </div>
</DialogTemplate>

<style>
  .release-notes :global(h1),
  .release-notes :global(h2),
  .release-notes :global(h3) {
    font-weight: 600;
    margin: 0.5em 0 0.25em;
  }
  .release-notes :global(h1) { font-size: 1.1em; }
  .release-notes :global(h2) { font-size: 1.05em; }
  .release-notes :global(h3) { font-size: 1em; }
  .release-notes :global(ul),
  .release-notes :global(ol) {
    padding-left: 1.5em;
    margin: 0.25em 0;
  }
  .release-notes :global(li) {
    margin: 0.15em 0;
  }
  .release-notes :global(p) {
    margin: 0.25em 0;
  }
  .release-notes :global(code) {
    background: rgba(127, 127, 127, 0.15);
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .release-notes :global(a) {
    text-decoration: underline;
  }
</style>
