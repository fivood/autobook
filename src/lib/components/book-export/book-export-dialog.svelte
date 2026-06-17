<script lang="ts">
  import { browser } from '$app/environment';
  import BookExportSelection from '$lib/components/book-export/book-export-selection.svelte';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import {
    getStorageIconData,
    isStorageSourceAvailable,
    storageSource$
  } from '$lib/data/storage/storage-view';
  import {
    lastExportedTarget$,
    lastExportedTypes$
  } from '$lib/data/store';
  import { executeReplicate$ } from '$lib/functions/replication/replication-progress';
  import { createEventDispatcher } from 'svelte';

  let icons = [
    { ...getStorageIconData(StorageKey.BACKUP), source: StorageKey.BACKUP, label: 'ZIP 文件' },
    { ...getStorageIconData(StorageKey.BROWSER), source: StorageKey.BROWSER, label: '浏览器数据库' }
  ];

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  $: if (browser) {
    icons = [
      ...icons
    ].filter((icon) => icon.source !== $storageSource$);
  }

  function replicateData() {
    executeReplicate$.next();

    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="content">
    <BookExportSelection
      {icons}
      bind:target={$lastExportedTarget$}
      bind:dataToReplicate={$lastExportedTypes$}
    />
  </svelte:fragment>
  <div class="flex grow justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => dispatch('close')}>
      取消
      <Ripple />
    </button>
    <button
      class={buttonClasses}
      class:cursor-not-allowed={!$lastExportedTypes$.length}
      disabled={!$lastExportedTypes$.length}
      on:click={replicateData}
    >
      开始
      <Ripple />
    </button>
  </div>
</DialogTemplate>
