<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import {
    isAppDefault,
    type FsHandle,
    type StorageSourceSaveResult,
    type StorageUnlockAction
  } from '$lib/data/storage/storage-source-manager';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { database } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';

  export let configuredName: string;
  export let configuredIsSyncTarget: boolean;
  export let configuredIsStorageSourceDefault: boolean;
  export let configuredType: StorageKey;
  export let configuredRemoteData: StorageUnlockAction;
  export let configuredFSData: FsHandle;
  export let configuredStoredInManager: boolean;
  export let configuredEncryptionDisabled: boolean;
  export let resolver: (arg0: StorageSourceSaveResult | undefined) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let containerElm: HTMLElement;
  let nameElm: HTMLInputElement;
  let error = '';
  let storageSourceName = configuredName || '';
  let storageSourceIsSyncTarget = configuredIsSyncTarget || false;
  let storageSourceType = configuredType || StorageKey.TAURI_FS;

  async function save() {
    error = '';
    nameElm.setCustomValidity('');

    if (!nameElm.reportValidity()) return;

    if (isAppDefault(storageSourceName)) {
      nameElm.setCustomValidity('请选择其他名称');
      nameElm.reportValidity();
      return;
    }

    try {
      const toSave: BooksDbStorageSource = {
        name: storageSourceName,
        type: storageSourceType,
        storedInManager: false,
        encryptionDisabled: true,
        data: {} as any,
        lastSourceModified: Date.now()
      };

      await database.saveStorageSource(
        toSave,
        configuredName,
        storageSourceIsSyncTarget,
        false
      );

      closeDialog({ new: toSave, old: configuredName });
    } catch (err: any) {
      error = err.message;
    }
  }

  function closeDialog(data?: StorageSourceSaveResult) {
    resolver(data);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <div
    class="flex flex-col p-2 max-h-[50vh] overflow-auto sm:max-h-[75vh]"
    slot="content"
    bind:this={containerElm}
  >
    <input
      required
      type="text"
      placeholder="名称"
      bind:value={storageSourceName}
      bind:this={nameElm}
    />
    <div class="mt-4 flex items-center">
      <input id="cbx-source" type="checkbox" bind:checked={storageSourceIsSyncTarget} />
      <label for="cbx-source" class="ml-2">设为同步目标</label>
    </div>
    <select class="my-4" bind:value={storageSourceType}>
      <option value={StorageKey.TAURI_FS}>本地文件</option>
      <option value={StorageKey.BROWSER}>浏览器数据库</option>
    </select>
    {#if error}
      <div class="text-red-500">错误: {error}</div>
    {/if}
  </div>
  <div class="mt-4 flex grow justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => closeDialog()}>
      取消
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={save}>
      保存
      <Ripple />
    </button>
  </div>
</DialogTemplate>
