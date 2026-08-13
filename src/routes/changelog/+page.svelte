<script lang="ts">
  import { t } from '$lib/i18n';
  import { afterNavigate } from '$app/navigation';
  import Fa from 'svelte-fa';
  import {
    faTriangleExclamation,
    faRotateLeft
  } from '@fortawesome/free-solid-svg-icons';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { confirmResetUiSettings } from '$lib/functions/reset-ui-settings';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
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

  function performReset() {
    confirmResetUiSettings(() => {
      resetting = true;
    });
  }

  function needsResetButton(callouts: string[]): boolean {
    return callouts.some((c) => /重置|reset/i.test(c));
  }

  let prevPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;

  afterNavigate((navigation) => {
    const { from } = navigation;
    if (!from?.url) return;
    prevPage = `${from.url.pathname}${from.url.search}`;
  });
</script>

<svelte:head>
  <title>{formatPageTitle($t('pageTitle.changelog'))}</title>
</svelte:head>

<div class="flex h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="flex flex-shrink-0 items-center gap-4 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <h1 class="text-xl font-medium">{$t('pageTitle.changelog')}</h1>
    <span class="text-sm opacity-50">{$t('changelog.count', { count: sections.length })}</span>
    <div class="flex-1" />
    <MergedHeaderIcon leavePageLink={prevPage} />
  </header>

  <div class="flex flex-1 overflow-hidden">
    <aside class="flex w-40 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-current/10 p-3 text-sm">
      {#each sections as s, i (s.version)}
        <button
          type="button"
          class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover-soft"
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
        <p class="py-12 text-center opacity-50">{$t('changelog.empty')}</p>
      {:else}
        {@const current = sections[activeIdx]}
        <h2 class="mb-4 text-2xl font-medium">v{current.version}</h2>
        {#if current.callouts.length}
          <div class="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <div class="mb-2 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
              <Fa icon={faTriangleExclamation} /> {$t('changelog.notes')}
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
              ><Fa icon={faRotateLeft} size="xs" /> {resetting ? $t('changelog.resetting') : $t('changelog.resetNow')}</button>
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
