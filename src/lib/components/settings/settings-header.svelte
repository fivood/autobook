<script lang="ts">
  import { faBookOpenReader, faClock, faDatabase, faPalette, faVolumeHigh } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { baseHeaderClasses, pxScreen } from '$lib/css-classes';
  import { t } from '$lib/i18n';

  export let leavePageLink: string;
  export let activeSettings: string;

  // `label` is the internal dispatch identifier used across
  // settings-content.svelte and the parent page; only `labelKey` is
  // resolved through $t at render time.
  const settingItems = [
    { label: 'Reader', labelKey: 'settings.tab.reader', icon: faBookOpenReader },
    { label: 'TTS', labelKey: 'settings.tab.tts', icon: faVolumeHigh },
    { label: 'Appearance', labelKey: 'settings.tab.appearance', icon: faPalette },
    { label: 'Data', labelKey: 'settings.tab.data', icon: faDatabase },
    { label: 'Statistics', labelKey: 'settings.tab.statistics', icon: faClock }
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
          <span class="whitespace-nowrap">{$t(settingItem.labelKey)}</span>
          <Ripple />
        </button>
      {/each}
    </div>
    <MergedHeaderIcon {leavePageLink} />
  </div>
</div>

<style>
  /* Same language as the dropdown menus outside settings (locale picker,
     library sort menu): this bar already sits on `bg-menu`, so selected and
     hovered rows invert to the menu foreground instead of being tinted.
     Fully opaque on purpose — the old `opacity: .5` greyed the label against
     the dark menu bar, which read as a different design system the moment a
     real menu opened next to it. */
  .settings-tab {
    background: transparent;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .settings-tab.is-active {
    font-weight: 600;
    background: var(--menu-foreground);
    color: var(--menu-background);
  }
  .settings-tab.is-inactive {
    font-weight: 400;
  }
  .settings-tab.is-inactive:hover {
    background: var(--menu-foreground);
    color: var(--menu-background);
  }
</style>
