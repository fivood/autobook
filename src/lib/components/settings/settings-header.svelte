<script lang="ts">
  import { faBookOpenReader, faClock, faDatabase, faPalette } from '@fortawesome/free-solid-svg-icons';
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
          class="flex flex-1 basis-0 flex-col items-center justify-center text-xs {activeSettings === settingItem.label ? 'bg-black/30' : ''} {activeSettings !== settingItem.label ? 'hover:bg-black/20' : ''}"
          on:click={() => (activeSettings = settingItem.label)}
        >
          <Fa class="mb-1" icon={settingItem.icon} />
          {settingItem.displayLabel}
          <Ripple />
        </button>
      {/each}
    </div>
    <MergedHeaderIcon {leavePageLink} />
  </div>
</div>
