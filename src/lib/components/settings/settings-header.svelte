<script lang="ts">
  import {
    faBookOpenReader,
    faClock,
    faDatabase,
    faFileLines,
    faPalette,
    faVolumeHigh,
    faWandMagicSparkles
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import PageHeader from '$lib/components/page-header/page-header.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { t } from '$lib/i18n';

  export let leavePageLink: string;
  export let activeSettings: string;

  // `label` is the internal dispatch identifier used across
  // settings-content.svelte and the parent page; only `labelKey` is
  // resolved through $t, and only as the tooltip — the bar is icons.
  const settingItems = [
    { label: 'Reader', labelKey: 'settings.tab.reader', icon: faBookOpenReader },
    { label: 'TTS', labelKey: 'settings.tab.tts', icon: faVolumeHigh },
    { label: 'OCR', labelKey: 'settings.tab.ocr', icon: faFileLines },
    { label: 'AI', labelKey: 'settings.tab.ai', icon: faWandMagicSparkles },
    { label: 'Appearance', labelKey: 'settings.tab.appearance', icon: faPalette },
    { label: 'Data', labelKey: 'settings.tab.data', icon: faDatabase },
    { label: 'Statistics', labelKey: 'settings.tab.statistics', icon: faClock }
  ];
</script>

<PageHeader
  icon={mergeEntries.SETTINGS.icon}
  titleKey="menu.settings.title"
  backLink={leavePageLink}
>
  <svelte:fragment slot="left">
    {#each settingItems as settingItem (settingItem.label)}
      <button
        type="button"
        class="chrome-tab flex h-full items-center justify-center px-3 text-lg xl:px-2.5 {activeSettings ===
        settingItem.label
          ? 'is-active'
          : 'is-inactive'}"
        title={$t(settingItem.labelKey)}
        aria-label={$t(settingItem.labelKey)}
        on:click={() => (activeSettings = settingItem.label)}
        aria-pressed={activeSettings === settingItem.label}
      >
        <Fa icon={settingItem.icon} />
        <Ripple />
      </button>
    {/each}
  </svelte:fragment>
</PageHeader>
