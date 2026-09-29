<script lang="ts">
  import BookExportIcon from '$lib/components/book-export/book-export-icon.svelte';
  import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
  import type { StorageIconElement } from '$lib/data/storage/storage-view';
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';

  export let icons: StorageIconElement[];
  export let target: StorageKey;
  export let dataToReplicate: StorageDataType[];

  onMount(() => {
    if (!icons.find((icon) => icon.source === target)) {
      target = StorageKey.BACKUP;
    }
  });
</script>

<h2 class="mb-4 text-xl font-medium">{$t('bookExport.targetHeading')}</h2>
<div class="mb-4 grid grid-cols-2 gap-8">
  {#each icons as icon (icon.source)}
    <BookExportIcon
      {...icon}
      disabled={false}
      selected={icon.source === target}
      on:click={() => {
        target = icon.source;
      }}
    />
  {/each}
</div>
<h2 class="mb-2 text-xl font-medium">{$t('bookExport.contentHeading')}</h2>
<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
  <div class="mr-4">
    <input type="checkbox" id="bookdata" name="data" value="data" bind:group={dataToReplicate} />
    <label for="bookdata">{$t('bookExport.content.bookData')}</label>
  </div>
  <div>
    <input
      type="checkbox"
      id="bookprogress"
      name="bookmark"
      value="bookmark"
      bind:group={dataToReplicate}
    />
    <label for="bookprogress">{$t('bookExport.content.bookmarks')}</label>
  </div>
  <div>
    <input
      type="checkbox"
      id="bookstatistic"
      name="statistic"
      value="statistic"
      bind:group={dataToReplicate}
    />
    <label for="bookstatistic">{$t('bookExport.content.statistics')}</label>
  </div>
  <div>
    <input
      type="checkbox"
      id="audioBook"
      name="audioBook"
      value="audioBook"
      bind:group={dataToReplicate}
    />
    <label for="audioBook">{$t('bookExport.content.audioBooks')}</label>
  </div>
  <div>
    <input
      type="checkbox"
      id="subtitle"
      name="subtitle"
      value="subtitle"
      bind:group={dataToReplicate}
    />
    <label for="subtitle">{$t('bookExport.content.subtitles')}</label>
  </div>
  <div>
    <input
      type="checkbox"
      id="highlight"
      name="highlight"
      value="highlight"
      bind:group={dataToReplicate}
    />
    <label for="highlight">{$t('bookExport.content.highlights')}</label>
  </div>
</div>
