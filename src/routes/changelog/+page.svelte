<script lang="ts">
  import { goto } from '$app/navigation';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { pagePath } from '$lib/data/env';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import rawChangelog from '../../../CHANGELOG.md?raw';

  interface Section {
    version: string;
    items: string[];
  }

  const sections: Section[] = parse(rawChangelog as string);

  function parse(md: string): Section[] {
    const lines = md.split(/\r?\n/);
    const out: Section[] = [];
    let current: Section | undefined;
    for (const line of lines) {
      const verMatch = /^## +(.+?)\s*$/.exec(line);
      if (verMatch) {
        current = { version: verMatch[1], items: [] };
        out.push(current);
        continue;
      }
      if (!current) continue;
      const itemMatch = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (itemMatch) {
        current.items.push(itemMatch[1]);
      }
    }
    return out;
  }

  let activeIdx = 0;
</script>

<svelte:head>
  <title>{formatPageTitle('更新历史')}</title>
</svelte:head>

<div class="flex min-h-screen flex-col" style="color:var(--font-color);background:var(--background-color);">
  <header class="sticky top-0 z-10 flex items-center gap-4 border-b border-current/10 px-4 py-3" style="background:var(--background-color);">
    <button
      type="button"
      class="rounded p-2 hover:bg-black/5"
      title="返回书库"
      on:click={() => goto(`${pagePath}${mergeEntries.MANAGE.routeId}`)}
    ><Fa icon={faArrowLeft} /></button>
    <h1 class="text-xl font-medium">更新历史</h1>
    <span class="text-sm opacity-50">共 {sections.length} 个版本</span>
  </header>

  <div class="flex flex-1">
    <aside class="flex w-40 flex-shrink-0 flex-col gap-1 border-r border-current/10 p-3 text-sm">
      {#each sections as s, i (s.version)}
        <button
          type="button"
          class="rounded px-2 py-1.5 text-left hover:bg-black/5"
          style:font-weight={activeIdx === i ? '600' : '400'}
          style:opacity={activeIdx === i ? 1 : 0.7}
          on:click={() => (activeIdx = i)}
        >v{s.version}</button>
      {/each}
    </aside>

    <main class="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
      {#if !sections.length}
        <p class="py-12 text-center opacity-50">CHANGELOG 为空</p>
      {:else}
        {@const current = sections[activeIdx]}
        <h2 class="mb-4 text-2xl font-medium">v{current.version}</h2>
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
