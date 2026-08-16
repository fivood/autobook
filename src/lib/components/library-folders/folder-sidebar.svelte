<script lang="ts">
  import { faFolder, faFolderOpen, faPlus, faPencil, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { dialogManager } from '$lib/data/dialog-manager';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import TextInputDialog from '$lib/components/text-input-dialog.svelte';
  import { activateOnKeyup } from '$lib/functions/utils';
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import { tick } from 'svelte';
  import {
    folders$,
    bookFolders$,
    activeFolderFilter$,
    createFolder,
    renameFolder,
    deleteFolder,
    addBooksToFolder
  } from '$lib/data/library-folders';
  import { t, tImmediate } from '$lib/i18n';

  /** Total book count in the library — shown next to "全部书籍". */
  export let totalBookCount: number;

  const dispatch = createEventDispatcher<{ booksAddedToFolder: { folderId: number; count: number } }>();

  let dragOverFolderId: number | string | null = null;
  let renamingId: number | null = null;
  let renameDraft = '';
  let renameInput: HTMLInputElement | undefined;

  $: if (renamingId !== null && renameInput) {
    tick().then(() => renameInput?.focus());
  }

  function countForFolder(folderId: number): number {
    return $bookFolders$.filter((bf) => bf.folderId === folderId).length;
  }

  /**
   * Hand-made categories above, directory-mirrored ones below. A vault with a
   * deep tree produces a lot of folders, and mixed into one list they bury the
   * handful the user actually created. The local group is hidden entirely
   * until something has been folder-imported.
   */
  $: folderGroups = [
    {
      key: 'reader',
      label: $t('folders.groupHeader'),
      items: $folders$.filter((f) => f.source !== 'local'),
      canCreate: true
    },
    {
      key: 'local',
      label: $t('folders.groupLocal'),
      items: $folders$.filter((f) => f.source === 'local'),
      canCreate: false
    }
  ];

  $: assignedBookIds = new Set($bookFolders$.map((bf) => bf.bookId));
  $: uncategorizedCount = Math.max(0, totalBookCount - assignedBookIds.size);

  function onCreateFolder() {
    dialogManager.dialogs$.next([
      {
        component: TextInputDialog,
        props: {
          dialogHeader: tImmediate('folders.dialog.new'),
          placeholder: '',
          resolver: async (name: string | undefined) => {
            if (!name) return;
            const created = await createFolder(name);
            if (created) activeFolderFilter$.next(String(created.id));
          }
        }
      }
    ]);
  }

  function startRename(id: number, current: string) {
    renamingId = id;
    renameDraft = current;
  }

  async function commitRename() {
    if (renamingId == null) return;
    const id = renamingId;
    renamingId = null;
    const next = renameDraft.trim();
    if (next) await renameFolder(id, next);
  }

  function confirmDelete(id: number, name: string) {
    dialogManager.dialogs$.next([
      {
        component: ConfirmDialog,
        props: {
          dialogHeader: tImmediate('folders.dialog.delete'),
          dialogMessage: tImmediate('folders.dialog.deleteConfirm', { name }),
          resolver: async (wasCanceled: boolean) => {
            if (!wasCanceled) await deleteFolder(id);
          }
        }
      }
    ]);
  }

  function readDraggedBookIds(ev: DragEvent): number[] {
    if (!ev.dataTransfer) return [];
    try {
      const raw = ev.dataTransfer.getData('application/x-autobook-book-ids');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  }

  async function onDropToFolder(ev: DragEvent, folderId: number) {
    ev.preventDefault();
    dragOverFolderId = null;
    const ids = readDraggedBookIds(ev);
    if (!ids.length) return;
    await addBooksToFolder(ids, folderId);
    dispatch('booksAddedToFolder', { folderId, count: ids.length });
  }

  function onDragOverFolder(ev: DragEvent, key: number | string) {
    if (!ev.dataTransfer?.types?.includes('application/x-autobook-book-ids')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    dragOverFolderId = key;
  }
</script>

<aside
  class="flex w-52 shrink-0 flex-col gap-1 border-r-2 border-current/20 bg-current/5 py-3 pr-2 pl-3 text-sm"
  style="min-height: calc(100vh - 4rem);"
>
  <div class="px-3 pb-1 text-xs uppercase tracking-wide opacity-60">{$t('folders.section')}</div>

  <button
    type="button"
    class="flex items-center justify-between rounded px-3 py-1.5 text-left hover-soft"
    class:bg-soft-active={'all' === $activeFolderFilter$}
    on:click={() => activeFolderFilter$.next('all')}
  >
    <span>{$t('folders.allBooks')}</span>
    <span class="opacity-60">{totalBookCount}</span>
  </button>

  <button
    type="button"
    class="flex items-center justify-between rounded px-3 py-1.5 text-left hover-soft"
    class:bg-soft-active={'uncategorized' === $activeFolderFilter$}
    on:click={() => activeFolderFilter$.next('uncategorized')}
  >
    <span>{$t('folders.uncategorized')}</span>
    <span class="opacity-60">{uncategorizedCount}</span>
  </button>

  <div class="flex-1 overflow-y-auto pr-1">
    {#each folderGroups as group (group.key)}
      {#if group.items.length || group.canCreate}
        <div
          class="mt-3 flex items-center justify-between px-3 pb-1 text-xs uppercase tracking-wide opacity-60"
        >
          <span>{group.label}</span>
          {#if group.canCreate}
            <button
              type="button"
              title={$t('folders.new')}
              class="rounded p-1 hover-soft"
              on:click={onCreateFolder}
            >
              <Fa icon={faPlus} />
            </button>
          {/if}
        </div>
      {/if}
    {#each group.items as folder (folder.id)}
      {@const active = $activeFolderFilter$ === String(folder.id)}
      {@const dragOver = dragOverFolderId === folder.id}
      <div
        class="group flex items-center gap-1 rounded px-2 py-1.5 transition-colors"
        class:bg-soft-active={active}
        class:ring-2={dragOver}
        class:ring-current={dragOver}
        on:dragover={(ev) => onDragOverFolder(ev, folder.id)}
        on:dragleave={() => (dragOverFolderId = null)}
        on:drop={(ev) => onDropToFolder(ev, folder.id)}
        role="button"
        tabindex="0"
      >
        <Fa icon={active ? faFolderOpen : faFolder} class="opacity-70 shrink-0" />
        {#if renamingId === folder.id}
          <input
            class="min-w-0 flex-1 rounded border border-current/30 bg-background-color px-1 py-0.5 text-sm"
            bind:value={renameDraft}
            on:keydown={(ev) => {
              if (ev.key === 'Enter') commitRename();
              if (ev.key === 'Escape') (renamingId = null);
            }}
            on:blur={commitRename}
            on:keyup={activateOnKeyup}
            bind:this={renameInput}
          />
        {:else}
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left"
            on:click={() => activeFolderFilter$.next(String(folder.id))}
          >
            {folder.name}
          </button>
        {/if}
        <span class="text-xs opacity-60">{countForFolder(folder.id)}</span>
        <button
          type="button"
          title={$t('folders.rename')}
          class="pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-60 hover:opacity-100 px-1"
          on:click|stopPropagation={() => startRename(folder.id, folder.name)}
        >
          <Fa icon={faPencil} />
        </button>
        <button
          type="button"
          title={$t('folders.delete')}
          class="pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-60 hover:opacity-100 px-1"
          on:click|stopPropagation={() => confirmDelete(folder.id, folder.name)}
        >
          <Fa icon={faTrash} />
        </button>
      </div>
    {/each}
      {#if group.canCreate && !group.items.length}
        <div class="px-3 pt-2 text-xs opacity-50">{$t('folders.empty')}</div>
      {/if}
    {/each}
  </div>
</aside>
