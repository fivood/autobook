<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPlus, faPen, faTrash, faFolder } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbHighlightFolder } from '$lib/data/database/books-db/versions/books-db';
  import { t, tImmediate } from '$lib/i18n';
  import { dialogManager } from '$lib/data/dialog-manager';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import TextInputDialog from '$lib/components/text-input-dialog.svelte';

  export let folders: BooksDbHighlightFolder[] = [];
  export let counts: Record<string, number> = {};
  export let selectedKey: string = 'all';

  const dispatch = createEventDispatcher<{
    select: string;
    create: string;
    rename: { id: number; name: string };
    delete: number;
  }>();

  let renamingId: number | null = null;
  let renameDraft = '';
  let renameInputEl: HTMLInputElement | undefined;

  function startCreate() {
    dialogManager.dialogs$.next([
      {
        component: TextInputDialog,
        props: {
          dialogHeader: tImmediate('notebook.dialog.new'),
          placeholder: tImmediate('notebook.folderNamePrompt'),
          resolver: (name: string | undefined) => {
            if (name) dispatch('create', name);
          }
        }
      }
    ]);
  }

  function startRename(f: BooksDbHighlightFolder) {
    renamingId = f.id;
    renameDraft = f.name;
    tick().then(() => renameInputEl?.focus());
  }

  function commitRename() {
    if (renamingId == null) return;
    const id = renamingId;
    const next = renameDraft.trim();
    const current = folders.find((f) => f.id === id)?.name ?? '';
    renamingId = null;
    if (next && next !== current) dispatch('rename', { id, name: next });
  }

  function cancelRename() {
    renamingId = null;
  }

  function startDelete(f: BooksDbHighlightFolder) {
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: tImmediate('notebook.dialog.delete'),
          dialogMessage: tImmediate('notebook.folderDeleteConfirm', { name: f.name }),
          resolver: (wasCanceled: boolean) => {
            if (!wasCanceled) dispatch('delete', f.id);
          }
        }
      }
    ]);
  }
</script>

<aside class="flex w-48 flex-shrink-0 flex-col border-r border-current/10 p-3 text-sm">
  <div class="mb-1 flex items-center justify-between">
    <h2 class="text-xs font-medium uppercase opacity-50">{$t('notebook.sidebar.views')}</h2>
  </div>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover-soft {selectedKey === 'all' ? 'bg-soft-active' : ''}"
    style:font-weight={selectedKey === 'all' ? '600' : '400'}
    on:click={() => dispatch('select', 'all')}
  >{$t('notebook.sidebar.all')} <span class="text-xs opacity-50">{counts.all ?? 0}</span></button>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover-soft {selectedKey === 'unfiled' ? 'bg-soft-active' : ''}"
    style:font-weight={selectedKey === 'unfiled' ? '600' : '400'}
    on:click={() => dispatch('select', 'unfiled')}
  >{$t('notebook.uncategorized')} <span class="text-xs opacity-50">{counts.unfiled ?? 0}</span></button>
  <button
    type="button"
    class="rounded px-2 py-1.5 text-left hover-soft {selectedKey === 'standalone' ? 'bg-soft-active' : ''}"
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
    {@const active = selectedKey === key}
    <div class="group flex items-center gap-1 rounded hover-soft {active ? 'bg-soft-active' : ''}">
      <Fa icon={faFolder} size="xs" class="ml-2 opacity-60" />
      {#if renamingId === f.id}
        <input
          class="min-w-0 flex-1 rounded border border-current/20 bg-transparent px-1.5 py-1 text-sm"
          bind:value={renameDraft}
          bind:this={renameInputEl}
          on:keydown={(ev) => {
            if (ev.key === 'Enter') commitRename();
            if (ev.key === 'Escape') cancelRename();
          }}
          on:blur={commitRename}
        />
      {:else}
        <button
          type="button"
          class="flex-1 truncate py-1.5 pr-2 text-left"
          style:font-weight={active ? '600' : '400'}
          on:click={() => dispatch('select', key)}
        >
          {f.name} <span class="text-xs opacity-50">{counts[key] ?? 0}</span>
        </button>
        <button
          type="button"
          class="pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-50 hover:!opacity-100"
          title={$t('folders.rename')}
          on:click={() => startRename(f)}
        ><Fa icon={faPen} size="xs" /></button>
        <button
          type="button"
          class="pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-50 hover:!opacity-100 hover-danger"
          title={$t('folders.delete')}
          on:click={() => startDelete(f)}
        ><Fa icon={faTrash} size="xs" /></button>
      {/if}
    </div>
  {/each}
</aside>
