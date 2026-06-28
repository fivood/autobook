<script lang="ts">
  import { faBookOpenReader, faClock, faDatabase, faPalette, faVolumeHigh } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { baseHeaderClasses, pxScreen } from '$lib/css-classes';

  export let leavePageLink: string;
  export let activeSettings: string;

  const settingItems = [
    {
      label: 'Reader',
      displayLabel: '阅读',
      icon: faBookOpenReader
    },
    {
      label: 'TTS',
      displayLabel: 'TTS',
      icon: faVolumeHigh
    },
    {
      label: 'Appearance',
      displayLabel: '外观',
      icon: faPalette
    },
    {
      label: 'Data',
      displayLabel: '数据',
      icon: faDatabase
    },
    {
      label: 'Statistics',
      displayLabel: '统计',
      icon: faClock
    }
  ];
</script>

<div class={baseHeaderClasses}>
  <div class="{pxScreen} flex px-0 md:px-5">
    <div class="flex h-12 grow justify-evenly xl:h-10">
      {#each settingItems as settingItem (settingItem.label)}
        <button
          type="button"
          class="settings-tab flex flex-1 basis-0 flex-row items-center justify-center gap-1.5 px-1 text-sm transition-colors sm:gap-2 sm:text-base {activeSettings === settingItem.label ? 'is-active' : 'is-inactive'}"
          on:click={() => (activeSettings = settingItem.label)}
          aria-pressed={activeSettings === settingItem.label}
        >
          <Fa icon={settingItem.icon} />
          <span class="whitespace-nowrap">{settingItem.displayLabel}</span>
          <Ripple />
        </button>
      {/each}
    </div>
    <MergedHeaderIcon {leavePageLink} />
  </div>
</div>

<style>
  /* Same active/inactive language as ButtonToggleGroup so settings feels
     consistent: inactive = transparent + 50% opacity + thin foreground
     accent line, active = bold + full opacity + accent background. */
  .settings-tab {
    background: transparent;
    transition: background-color 0.12s ease, opacity 0.12s ease;
  }
  .settings-tab.is-active {
    opacity: 1;
    font-weight: 600;
    background: color-mix(in srgb, currentColor 14%, transparent);
    box-shadow: inset 0 -2px 0 currentColor;
  }
  .settings-tab.is-inactive {
    opacity: 0.5;
    font-weight: 400;
  }
  .settings-tab.is-inactive:hover {
    opacity: 0.85;
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
</style>
