<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faPen, faTrash, faFolder } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbHighlightFolder } from '$lib/data/database/books-db/versions/books-db';
  import { t, tImmediate } from '$lib/i18n';

  export let folders: BooksDbHighlightFolder[] = [];
  export let counts: Record<string, number> = {};
  export let selectedKey: string = 'all';

  const dispatch = createEventDispatcher<{
    select: string;
    create: string;
    rename: { id: number; name: string };
    delete: number;
  }>();

  function startCreate() {
    const name = prompt(tImmediate('notebook.folderNamePrompt'));
    if (name && name.trim()) dispatch('create', name.trim());
  }

  function startRename(f: BooksDbHighlightFolder) {
    const name = prompt(tImmediate('folders.rename'), f.name);
    if (name && name.trim() && name.trim() !== f.name) {
      dispatch('rename', { id: f.id, name: name.trim() });
    }
  }

  function startDelete(f: BooksDbHighlightFolder) {
    if (confirm(tImmediate('notebook.folderDeleteConfirm', { name: f.name }))) {
      dispatch('delete', f.id);
    }
  }
</script>

<aside class="flex w-48 flex-shrink-0 flex-col border-r border-current/10 p-3 text-sm">
  <div class="mb-1 flex items-center justify-between">
    <h2 class="text-xs font-medium uppercase opacity-50">{$t('notebook.sidebar.views')}</h2>
  </div>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover:bg-black/5"
    class:bg-black-5={selectedKey === 'all'}
    style:font-weight={selectedKey === 'all' ? '600' : '400'}
    on:click={() => dispatch('select', 'all')}
  >{$t('notebook.sidebar.all')} <span class="text-xs opacity-50">{counts.all ?? 0}</span></button>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover:bg-black/5"
    style:font-weight={selectedKey === 'unfiled' ? '600' : '400'}
    on:click={() => dispatch('select', 'unfiled')}
  >{$t('notebook.uncategorized')} <span class="text-xs opacity-50">{counts.unfiled ?? 0}</span></button>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover:bg-black/5"
    style:font-weight={selectedKey === 'standalone' ? '600' : '400'}
    on:click={() => dispatch('select', 'standalone')}
  >{$t('notebook.standalone')} <span class="text-xs opacity-50">{counts.standalone ?? 0}</span></button>

  <div class="mt-4 mb-1 flex items-center justify-between">
    <h2 class="text-xs font-medium uppercase opacity-50">{$t('notebook.foldersHeader')}</h2>
    <button
      type="button"
      class="opacity-50 hover:opacity-100"
      title={$t('folders.new')}
      on:click={startCreate}
    ><Fa icon={faPlus} size="xs" /></button>
  </div>
  {#if !folders.length}
    <p class="px-2 py-1 text-xs opacity-40">{$t('notebook.noFolders')}</p>
  {/if}
  {#each folders as f (f.id)}
    {@const key = `folder:${f.id}`}
    <div class="group flex items-center gap-1">
      <button
        type="button"
        class="flex-1 truncate rounded px-2 py-1.5 text-left hover:bg-black/5"
        style:font-weight={selectedKey === key ? '600' : '400'}
        on:click={() => dispatch('select', key)}
      >
        <Fa icon={faFolder} size="xs" class="mr-1 opacity-60" />
        {f.name} <span class="text-xs opacity-50">{counts[key] ?? 0}</span>
      </button>
      <button
        type="button"
        class="opacity-0 group-hover:opacity-50 hover:!opacity-100"
        title={$t('folders.rename')}
        on:click={() => startRename(f)}
      ><Fa icon={faPen} size="xs" /></button>
      <button
        type="button"
        class="opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:text-red-500"
        title={$t('folders.delete')}
        on:click={() => startDelete(f)}
      ><Fa icon={faTrash} size="xs" /></button>
    </div>
  {/each}
</aside>
