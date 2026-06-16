<script lang="ts">
  import { browser } from '$app/environment';
  import {
    faCircleQuestion,
    faCloudArrowUp,
    faPenToSquare,
    faPlus,
    faSpinner,
    faTableList,
    faTrash,
    faTriangleExclamation
  } from '@fortawesome/free-solid-svg-icons';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import Popover from '$lib/components/popover/popover.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsStorageSource from '$lib/components/settings/settings-storage-source.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    isAppDefault,
    type FsHandle,
    type StorageSourceSaveResult,
    type StorageUnlockAction,
    type RemoteContext,
    unlockStorageData
  } from '$lib/data/storage/storage-source-manager';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { getStorageIconData } from '$lib/data/storage/storage-view';
  import {
    autoReplication$,
    database,
    isOnline$,
    syncTarget$
  } from '$lib/data/store';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { dummyFn } from '$lib/functions/utils';
  import Fa from 'svelte-fa';

  export let storageSources: BooksDbStorageSource[];

  let listLoading = true;
  let listTooltip = '管理存储来源';

  $: if (storageSources) {
    listLoading = false;
  }

  function isSyncTarget(name: string, referenceName: string) {
    return name === referenceName;
  }

  async function modifyStorageSource(storageSource?: BooksDbStorageSource) {
    let configuredRemoteData: StorageUnlockAction | undefined;
    let configuredFSData: FsHandle | undefined;

    const saveResult = await new Promise<StorageSourceSaveResult>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SettingsStorageSource,
          props: {
            configuredName: storageSource?.name,
            configuredType: storageSource?.type,
            configuredIsSyncTarget: storageSource ? $syncTarget$ === storageSource.name : false,
            configuredIsStorageSourceDefault: false,
            configuredFSData,
            configuredRemoteData,
            configuredStoredInManager: storageSource?.storedInManager,
            configuredEncryptionDisabled: storageSource?.encryptionDisabled,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (!saveResult) {
      return;
    }

    if (saveResult.old) {
      database.storageSourcesChanged$.next(
        storageSources.map((entry) => (entry.name === saveResult.old ? saveResult.new : entry))
      );
    } else {
      database.storageSourcesChanged$.next([...storageSources, saveResult.new]);
    }
  }

  async function deleteStorageSource(
    storageSource: BooksDbStorageSource,
    wasSyncTarget: boolean,
    wasSourceDefault: boolean
  ) {
    const unlockResult = await unlockStorageData(
      storageSource,
      '您正在尝试删除数据',
      {
        action: `请确认继续删除 ${storageSource.name}`,
        requiresSecret: false,
        showCancel: true
      }
    );

    if (!unlockResult) {
      return;
    }

    await database.deleteStorageSource(storageSource, wasSyncTarget, wasSourceDefault);

    database.storageSourcesChanged$.next(
      storageSources.filter((source) => source.name !== storageSource.name)
    );
  }
</script>

<div class="mb-8 sm:col-span-2 lg:col-span-3">
  <div class="flex">
    <div class="flex grow">
      <h1 class="mb-2 text-xl font-medium">
        <span class="capitalize">存储来源</span>
      </h1>
      <Popover contentText={listTooltip} contentStyles="padding: 0.5rem;">
        <Fa icon={faCircleQuestion} slot="icon" class="mx-2" />
      </Popover>
      {#if $autoReplication$ !== AutoReplicationType.Off && !$syncTarget$}
        <Popover
          contentText={'已启用自动导入/导出，但未从列表中选择同步目标'}
          contentStyles="padding: 0.25rem;"
        >
          <Fa icon={faTriangleExclamation} slot="icon" class="mx-2" />
        </Popover>
      {/if}
    </div>
    <button
      class={buttonClasses}
      class:cursor-not-allowed={!storageSources}
      disabled={!storageSources}
      on:click={() => {
        modifyStorageSource();
      }}
    >
      <div class="flex items-center justify-center">
        <Fa icon={faPlus} />
        <span class="ml-1 hidden sm:block">添加</span>
      </div>
      <Ripple />
    </button>
  </div>
  <hr class="border border-black" />
  <div class="mt-6">
    {#if !listLoading && storageSources}
      <div class="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {#each storageSources as storageSource (storageSource.name)}
          {@const icon = getStorageIconData(storageSource.type)}
          {@const isDefault = isAppDefault(storageSource.name)}
          {@const storageSourceIsSyncTarget = isSyncTarget(storageSource.name, $syncTarget$)}
          <div class="flex flex-col">
            <div class="flex">
              <svg
                class="inline-block h-6 w-6 self-center"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={icon.viewBox}
              >
                <path class="fill-current" d={icon.d} />
              </svg>
              <div class="ml-3 self-center">{storageSource.name}</div>
            </div>
            <div class="mt-4 flex">
              <div
                tabindex="0"
                role="button"
                title="编辑来源"
                class="mr-4"
                class:hidden={isDefault}
                on:click={() => modifyStorageSource(storageSource)}
                on:keyup={dummyFn}
              >
                <Fa icon={faPenToSquare} />
              </div>
              <div
                tabindex="0"
                role="button"
                title="切换同步目标"
                class="mr-4"
                class:opacity-50={!storageSourceIsSyncTarget}
                on:click={() =>
                  syncTarget$.next($syncTarget$ === storageSource.name ? '' : storageSource.name)}
                on:keyup={dummyFn}
              >
                <Fa icon={faCloudArrowUp} />
              </div>
              <div
                tabindex="0"
                role="button"
                title="删除来源"
                class:hidden={isDefault}
                on:click={() =>
                  deleteStorageSource(
                    storageSource,
                    storageSourceIsSyncTarget,
                    false
                  )}
                on:keyup={dummyFn}
              >
                <Fa icon={faTrash} />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-xl">
        <Fa icon={faSpinner} spin />
      </div>
    {/if}
  </div>
  <div />
</div>
