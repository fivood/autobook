<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes } from '@fortawesome/free-solid-svg-icons';
  import { fly } from 'svelte/transition';
  import { quintInOut } from 'svelte/easing';
  import SettingsTts from '$lib/components/settings/settings-tts.svelte';
  import SettingsReaderBehavior from '$lib/components/settings/settings-reader-behavior.svelte';
  import SettingsTypography from '$lib/components/settings/settings-typography.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { pagePath } from '$lib/data/env';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { t } from '$lib/i18n';

  /** Decides which language slot the voice picker opens on. */
  export let bookLanguage: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  // `id` is the dispatch identity; only `labelKey` goes through $t.
  const tabs = [
    { id: 'tts', labelKey: 'readerSettings.tab.tts' },
    { id: 'typography', labelKey: 'readerSettings.tab.typography' },
    { id: 'behavior', labelKey: 'readerSettings.tab.behavior' }
  ];

  let activeTab = 'tts';
</script>

<!-- Deliberately NOT a grid, unlike the settings page's container: the panels
     inside carry `lg:col-span-3`, which is inert on a block parent but would
     spawn implicit columns in a one-column grid. -->
<div
  class="settings-scope fixed top-0 right-0 z-[80] flex h-full w-full max-w-md flex-col border-l border-current/10 shadow-2xl"
  style="color:var(--font-color);background:var(--background-color);"
  in:fly|local={{ x: 100, duration: 200, easing: quintInOut }}
  use:clickOutside={() => dispatch('close')}
>
  <div class="flex items-center gap-2 border-b border-current/10 px-4 py-3">
    <h2 class="text-lg font-medium">{$t('readerSettings.title')}</h2>
    <div class="flex-1" />
    <button
      type="button"
      class="rounded p-1.5 opacity-60 hover-soft hover:opacity-100"
      title={$t('readerSettings.close')}
      on:click={() => dispatch('close')}
    ><Fa icon={faTimes} /></button>
  </div>

  <div class="flex border-b border-current/10">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="drawer-tab relative flex-1 px-3 py-2 text-sm"
        class:is-active={activeTab === tab.id}
        aria-pressed={activeTab === tab.id}
        on:click={() => (activeTab = tab.id)}
      >
        {$t(tab.labelKey)}
        <Ripple />
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-3">
    {#if activeTab === 'tts'}
      <SettingsTts showSectionHeader={false} {bookLanguage} />
    {:else if activeTab === 'typography'}
      <SettingsTypography showSectionHeader={false} />
    {:else}
      <SettingsReaderBehavior showSectionHeader={false} />
    {/if}
  </div>

  <div class="border-t border-current/10 px-4 py-2 text-xs">
    <a class="underline opacity-70 hover:opacity-100" href="{pagePath}/settings"
      >{$t('readerSettings.more')}</a
    >
  </div>
</div>

<style>
  /* Page-surface palette, not menu: this is a drawer (see the theme contract
     in CLAUDE.md), so the active tab reads as a soft selection rather than the
     inverted fill the header's menu bar uses. */
  .drawer-tab {
    background: transparent;
    opacity: 0.6;
    transition: opacity 0.12s ease, background-color 0.12s ease;
  }
  .drawer-tab:hover {
    opacity: 1;
  }
  .drawer-tab.is-active {
    opacity: 1;
    font-weight: 600;
  }
  .drawer-tab.is-active::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    bottom: -1px;
    height: 2px;
    background: currentColor;
  }
</style>
