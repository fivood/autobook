<script lang="ts">
  import { browser } from '$app/environment';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { isTauri } from '$lib/data/env';
  import {
    checkForUpdate,
    type UpdateInfo
  } from '$lib/functions/updater/check-for-update';
  import UpdateDialog from '$lib/components/updater/update-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import MergedHeaderIcon from '$lib/components/merged-header-icon/merged-header-icon.svelte';
  import Popover from '$lib/components/popover/popover.svelte';
  import {
    baseHeaderClasses,
    baseIconClasses,
    nTranslateXHeaderFa,
    pHeaderFa,
    translateXHeaderFa
  } from '$lib/css-classes';
  import { SortDirection } from '$lib/data/sort-types';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    bookCoverMinWidth$,
    booklistSortOptions$,
    fileCountData$,
    libraryFilter$
  } from '$lib/data/store';
  import { BOOK_FORMAT_LABELS, type BookFormat } from '$lib/functions/book-format';

  // Most format labels are universal abbreviations (PDF/EPUB/MOBI/TXT/
  // Markdown/HTMLZ) — display as-is. Only `cbz`(漫画) and `other`(其他)
  // are locale-specific words, so those two go through i18n.
  function formatLabel(fmt: BookFormat): string {
    if (fmt === 'cbz') return tImmediate('bookFormat.cbz');
    if (fmt === 'other') return tImmediate('bookFormat.other');
    return BOOK_FORMAT_LABELS[fmt];
  }
  import { t, tImmediate } from '$lib/i18n';
  import LocalePicker from '$lib/components/locale-picker/locale-picker.svelte';

  const BOOK_FORMAT_KEYS = Object.keys(BOOK_FORMAT_LABELS) as BookFormat[];

  // Static options carry the i18n KEY instead of a translated label so the
  // arrays don't need to be rebuilt on locale switch; the template calls
  // $t(opt.labelKey) at render time. Same reason storageSourceMenuItems
  // and sortMenuItems below switched from `label` to `labelKey`.
  type CompletionId = 'all' | 'unread' | 'reading' | 'done';
  const COMPLETION_OPTIONS: { id: CompletionId; labelKey: string }[] = [
    { id: 'all', labelKey: 'manager.completion.all' },
    { id: 'unread', labelKey: 'manager.completion.unread' },
    { id: 'reading', labelKey: 'manager.completion.reading' },
    { id: 'done', labelKey: 'manager.completion.done' }
  ];
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { activateOnKeyup, isMobile$, isOnOldUrl } from '$lib/functions/utils';
  import {
    faArrowDownShortWide,
    faBoxArchive,
    faBoxOpen,
    faArrowDownWideShort,
    faCalendarXmark,
    faChartLine,
    faCircleXmark,
    faCloudArrowUp,
    faFilter,
    faSortDown,
    faSortUp,
    faTableCellsLarge,
    faTimes,
    faTrash
  } from '@fortawesome/free-solid-svg-icons';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { quintOut } from 'svelte/easing';
  import { scale } from 'svelte/transition';

  export let hasBookOpened: boolean;
  export let selectMode: boolean;
  export let selectedCount: number;

  /** The archive view is on screen, so the archive button restores instead. */
  export let showingArchive = false;
  export let hasBooks: boolean;
  export let cancelTooltip: string;
  export let replicationProgress: number;
  export let replicationToProgress: number;
  export let replicationProgressRemaining: string;

  const dispatch = createEventDispatcher<{
    selectAllClick: void;
    removeClick: void;
    domainHintClick: void;
    backToBookClick: void;
    filesChange: FileList;
    importBackup: File;
    selectionToStatistics: void;
    deleteStatistics: void;
    archiveClick: void;
    replicateData: void;
    cancelReplication: void;
  }>();

  const nTranslateXHeaderMat = '-translate-x-3 xl:-translate-x-2.5';

  const inAnimationParams = {
    delay: 150,
    duration: 150,
    easing: quintOut
  };

  const outAnimationParams = {
    duration: 150,
    easing: quintOut
  };

  const importMenuItems = [mergeEntries.FILE_IMPORT];

  let fileImportElm: HTMLElement;
  let folderImportElm: HTMLElement;
  let backupImportElm: HTMLElement;
  let countImportElm: HTMLInputElement;
  let sortOptionsElm: Popover;
  let isOldUrl = false;
  let showLoadCount = false;

  $: if (browser) {
    isOldUrl = isOnOldUrl(window);
    showLoadCount = new URLSearchParams(window.location.search).has('count');

    importMenuItems.push(
      ...($isMobile$
        ? [mergeEntries.BACKUP_IMPORT]
        : [mergeEntries.FOLDER_IMPORT, mergeEntries.BACKUP_IMPORT])
    );
  }

  $: sortMenuItems = [
    ...($storageSource$ === StorageKey.BROWSER
      ? [{ property: 'id', labelKey: 'manager.sort.addedTime' }]
      : []),
    { property: 'title', labelKey: 'manager.sort.title' },
    { property: 'characters', labelKey: 'manager.sort.characters' },
    { property: 'lastBookModified', labelKey: 'manager.sort.lastModified' },
    { property: 'lastBookOpen', labelKey: 'manager.sort.lastOpen' },
    { property: 'progress', labelKey: 'manager.sort.progress' },
    { property: 'lastBookmarkModified', labelKey: 'manager.sort.lastBookmark' }
  ];

  async function manualCheckUpdate() {
    let update: UpdateInfo | null = null;
    try {
      update = await checkForUpdate();
    } catch (err: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: { title: tImmediate('update.checkFailed'), message: err?.message ?? String(err) }
        }
      ]);
      return;
    }
    if (update) {
      dialogManager.dialogs$.next([{ component: UpdateDialog, props: { update } }]);
    } else {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: tImmediate('update.upToDate.title'),
            message: tImmediate('update.upToDate.body')
          }
        }
      ]);
    }
  }

  function triggerInput(event: CustomEvent<string>) {
    switch (event.detail) {
      case mergeEntries.FOLDER_IMPORT.label:
        folderImportElm.click();
        break;

      case mergeEntries.BACKUP_IMPORT.label:
        backupImportElm.click();
        break;

      default:
        fileImportElm.click();
        break;
    }
  }

  function dispatchFilesChange(fileList: FileList) {
    dispatch('filesChange', fileList);
  }

  function dispatchImportBackup(fileList: FileList) {
    dispatch('importBackup', fileList[0]);
  }

  async function setCountData(fileList: FileList) {
    try {
      $fileCountData$ = JSON.parse(await fileList[0].text());
    } catch ({ message }: any) {
      console.error(`failed to read file: ${message}`);
    }
  }

  function changeSortOptions(clickedProperty: string, newDirection: SortDirection) {
    const { property, direction } = $booklistSortOptions$[$storageSource$];

    if (property !== clickedProperty || direction !== newDirection) {
      booklistSortOptions$.next({
        ...$booklistSortOptions$,
        ...{
          [$storageSource$]: {
            property: clickedProperty as Exclude<
              keyof BookCardProps,
              'imagePath' | 'isPlaceholder'
            >,
            direction: newDirection
          }
        }
      });
    }

    sortOptionsElm.toggleOpen();
  }
</script>

<input
  hidden
  multiple
  type="file"
  accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,text/markdown,.md,.markdown,.mobi,.azw,.azw3,application/pdf,.pdf,.cbz,.cbr,.cb7,.cbt,application/zip,.zip"
  use:inputFile={dispatchFilesChange}
  bind:this={fileImportElm}
/>
<input
  hidden
  multiple
  type="file"
  use:inputAllowDirectory
  use:inputFile={dispatchFilesChange}
  bind:this={folderImportElm}
/>
<input
  hidden
  type="file"
  accept=".zip,application/zip"
  use:inputFile={dispatchImportBackup}
  bind:this={backupImportElm}
/>
<input
  hidden
  type="file"
  accept=".json,application/json"
  use:inputFile={setCountData}
  bind:this={countImportElm}
/>
<div class={baseHeaderClasses}>
  {#if !replicationToProgress}
    <div class="flex h-full justify-between px-4 md:px-8 xl:max-w-none 2xl:max-w-6xl mx-auto">
      {#if selectedCount === 0}
        <div
          title={selectMode ? $t('manager.selectMode.exit') : $t('manager.selectMode.enter')}
          class="transform-gpu {nTranslateXHeaderMat}"
          in:scale={inAnimationParams}
          out:scale={outAnimationParams}
        >
          <svg
            tabindex="0"
            role="button"
            aria-label={$t('manager.selectMode.aria')}
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            class:opacity-100={selectMode}
            class:opacity-60={!selectMode}
            class={baseIconClasses}
            on:click={() => (selectMode = hasBooks && !selectMode)}
            on:keyup={activateOnKeyup}
          >
            <title>{$t('manager.selectMode.aria')}</title>
            <path
              class="fill-current"
              d="M20,4v12H8V4H20 M20,2H8C6.9,2,6,2.9,6,4v12c0,1.1,0.9,2,2,2h12c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2L20,2z M12.47,14 L9,10.5l1.4-1.41l2.07,2.08L17.6,6L19,7.41L12.47,14z M4,6H2v14c0,1.1,0.9,2,2,2h14v-2H4V6z"
            />
          </svg>
        </div>
      {:else}
        <div
          class="flex h-full transform-gpu items-center {nTranslateXHeaderFa} text-xl font-medium"
        >
          <div
            tabindex="0"
            role="button"
            title={$t('manager.selectMode.exit')}
            class="flex h-full items-center text-2xl xl:text-xl {pHeaderFa} cursor-pointer"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
            on:click={() => (selectMode = !selectMode)}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={faTimes} />
          </div>
          <span
            class="translate-x-2 transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}>{selectedCount}</span
          >
        </div>
      {/if}

      <div class="absolute left-1/2 h-full -translate-x-1/2 transform-gpu">
        {#if !selectMode}
          {#if hasBookOpened}
            <div title={$t('manager.backToBook')}>
              <svg
                tabindex="0"
                role="button"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                class={baseIconClasses}
                in:scale={inAnimationParams}
                out:scale={outAnimationParams}
                on:click={() => dispatch('backToBookClick')}
                on:keyup={activateOnKeyup}
              >
                <path
                  class="fill-current"
                  d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5zm-3.5-8c.88 0 1.73.09 2.5.26V9.24c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99zM13 12.49v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26V11.9c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.3-4.5.83zm4.5 1.84c-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26v-1.52c-.79-.16-1.64-.24-2.5-.24z"
                />
              </svg>
            </div>
          {/if}
        {:else}
          <div title={$t('manager.selectAll')}>
            <svg
              tabindex="0"
              role="button"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              class={baseIconClasses}
              in:scale={inAnimationParams}
              out:scale={outAnimationParams}
              on:click={() => dispatch('selectAllClick')}
              on:keyup={activateOnKeyup}
            >
              <path
                class="fill-current"
                d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
              />
            </svg>
          </div>
        {/if}
      </div>

      <div class="flex transform-gpu {translateXHeaderFa}">
        {#if !selectMode}
          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <MergedHeaderIcon
              items={importMenuItems}
              mergeTo={mergeEntries.FILE_IMPORT}
              on:action={triggerInput}
            />
          </div>
          <!-- 存储源 picker 从 header 移到「设置 → 存储与备份 → 书库存储源」
               （1.19.2）。日常几乎不切换，占位不值。 -->

          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <Popover
              placement="bottom"
              fallbackPlacements={['bottom-end', 'bottom-start']}
              yOffset={0}
              bind:this={sortOptionsElm}
            >
              <div slot="icon" class={baseIconClasses} title={$t('manager.sort.order')}>
                {#if $booklistSortOptions$[$storageSource$].direction === SortDirection.ASC}
                  <Fa icon={faArrowDownShortWide} />
                {:else}
                  <Fa icon={faArrowDownWideShort} />
                {/if}
              </div>
              <div class="menu-list w-44" slot="content">
                {#each sortMenuItems as sortMenuItem (sortMenuItem.property)}
                  {@const isCurrentSort =
                    $booklistSortOptions$[$storageSource$].property === sortMenuItem.property}
                  {@const isCurrentSortAsc =
                    isCurrentSort &&
                    $booklistSortOptions$[$storageSource$].direction === SortDirection.ASC}
                  <div
                    class="menu-sort-item cursor-default"
                    class:menu-sort-item-active={isCurrentSort}
                  >
                    <div
                      tabindex="0"
                      role="button"
                      class="menu-icon-button self-center justify-self-start"
                      class:text-danger={isCurrentSortAsc}
                      class:hover-danger={!isCurrentSortAsc}
                      on:click={() => {
                        changeSortOptions(sortMenuItem.property, SortDirection.ASC);
                      }}
                      on:keyup={() => {}}
                    >
                      <Fa icon={faSortUp} class="px-4" />
                    </div>
                    <div class="px-2 py-2">
                      {$t(sortMenuItem.labelKey)}
                    </div>
                    <div
                      tabindex="0"
                      role="button"
                      class="menu-icon-button justify-self-end hover-danger"
                      class:text-danger={isCurrentSort && !isCurrentSortAsc}
                      class:hover-danger={!isCurrentSort || isCurrentSortAsc}
                      on:click={() => {
                        changeSortOptions(sortMenuItem.property, SortDirection.DESC);
                      }}
                      on:keyup={() => {}}
                    >
                      <Fa icon={faSortDown} class="mt-1 px-4" />
                    </div>
                  </div>
                {/each}
              </div>
            </Popover>
          </div>
          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <Popover
              placement="bottom"
              fallbackPlacements={['bottom-end', 'bottom-start']}
              yOffset={0}
            >
              <div slot="icon" class={baseIconClasses} title={$t('manager.filter')}>
                <Fa icon={faFilter} />
                {#if $libraryFilter$.formats.length || $libraryFilter$.completion !== 'all'}
                  <span class="filter-badge"></span>
                {/if}
              </div>
              <div class="filter-panel menu-panel w-72" slot="content">
                <div class="menu-label">{$t('manager.filter.format')}</div>
                <div class="flex flex-wrap gap-1.5 mb-3">
                  {#each BOOK_FORMAT_KEYS as fmt (fmt)}
                    {@const isActive = $libraryFilter$.formats.includes(fmt)}
                    <button
                      type="button"
                      class="menu-choice"
                      class:menu-choice-active={isActive}
                      on:click={() => {
                        const formats = isActive
                          ? $libraryFilter$.formats.filter((f) => f !== fmt)
                          : [...$libraryFilter$.formats, fmt];
                        $libraryFilter$ = { ...$libraryFilter$, formats };
                      }}
                    >{formatLabel(fmt)}</button>
                  {/each}
                </div>
                <div class="menu-label">{$t('manager.filter.completion')}</div>
                <div class="flex flex-wrap gap-1.5 mb-2">
                  {#each COMPLETION_OPTIONS as opt (opt.id)}
                    <button
                      type="button"
                      class="menu-choice"
                      class:menu-choice-active={$libraryFilter$.completion === opt.id}
                      on:click={() => ($libraryFilter$ = { ...$libraryFilter$, completion: opt.id })}
                    >{$t(opt.labelKey)}</button>
                  {/each}
                </div>
                {#if $libraryFilter$.formats.length || $libraryFilter$.completion !== 'all'}
                  <button
                    type="button"
                    class="mt-2 px-2 text-sm underline opacity-70 hover:opacity-100"
                    on:click={() => ($libraryFilter$ = { formats: [], completion: 'all' })}
                  >{$t('manager.filter.clearAll')}</button>
                {/if}
              </div>
            </Popover>
          </div>
          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <Popover
              placement="bottom"
              fallbackPlacements={['bottom-end', 'bottom-start']}
              yOffset={0}
            >
              <div slot="icon" class={baseIconClasses} title={$t('manager.cover.size')}>
                <Fa icon={faTableCellsLarge} />
              </div>
              <div class="menu-panel w-56" slot="content">
                <div class="menu-label mb-1">
                  {$t('manager.cover.minWidth', { n: $bookCoverMinWidth$ })}
                </div>
                <input
                  type="range"
                  min="120"
                  max="300"
                  step="10"
                  class="w-full"
                  bind:value={$bookCoverMinWidth$}
                />
                <div class="flex justify-between mt-2 gap-1">
                  <button
                    type="button"
                    class="menu-choice flex-1"
                    on:click={() => ($bookCoverMinWidth$ = 130)}
                  >{$t('manager.cover.dense')}</button>
                  <button
                    type="button"
                    class="menu-choice flex-1"
                    on:click={() => ($bookCoverMinWidth$ = 170)}
                  >{$t('manager.cover.standard')}</button>
                  <button
                    type="button"
                    class="menu-choice flex-1"
                    on:click={() => ($bookCoverMinWidth$ = 220)}
                  >{$t('manager.cover.large')}</button>
                </div>
                <div class="menu-label mt-1 opacity-60">{$t('manager.cover.autoLayout')}</div>
              </div>
            </Popover>
          </div>
          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <LocalePicker />
          </div>
          <div
            class="relative transform-gpu"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
          >
            <MergedHeaderIcon
              items={[
                ...(isOldUrl
                  ? [mergeEntries.MANAGE, mergeEntries.DOMAIN_HINT, mergeEntries.SETTINGS]
                  : [
                      mergeEntries.MANAGE,
                      mergeEntries.STATISTICS,
                      mergeEntries.NOTEBOOK,
                      mergeEntries.TRANSLATE,
                      mergeEntries.SETTINGS,
                      mergeEntries.CHANGELOG
                    ]),
                ...(isTauri() ? [mergeEntries.CHECK_UPDATE] : [])
              ]}
              on:action={({ detail }) => {
                if (detail === mergeEntries.DOMAIN_HINT.label) {
                  dispatch('domainHintClick');
                } else if (detail === mergeEntries.CHECK_UPDATE.label) {
                  manualCheckUpdate();
                }
              }}
            />
          </div>
          {#if showLoadCount}
            <button
              style:color={!!$fileCountData$ ? 'red' : null}
              on:click={() => countImportElm.click()}>C</button
            >
          {/if}
        {/if}

        {#if selectedCount > 0}
          <div
            tabindex="0"
            role="button"
            title={$t('manager.exportMenu')}
            class="transform-gpu {baseIconClasses}"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
            on:click={() => dispatch('replicateData')}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={faCloudArrowUp} />
          </div>
          {#if $storageSource$ === StorageKey.BROWSER}
            <div
              tabindex="0"
              role="button"
              title={$t('manager.viewStatistics')}
              class="transform-gpu {baseIconClasses}"
              in:scale={inAnimationParams}
              out:scale={outAnimationParams}
              on:click={() => dispatch('selectionToStatistics')}
              on:keyup={activateOnKeyup}
            >
              <Fa icon={faChartLine} />
            </div>
            <div
              tabindex="0"
              role="button"
              title={$t('manager.deleteStatistics')}
              class="transform-gpu {baseIconClasses}"
              in:scale={inAnimationParams}
              out:scale={outAnimationParams}
              on:click={() => dispatch('deleteStatistics')}
              on:keyup={activateOnKeyup}
            >
              <Fa icon={faCalendarXmark} />
            </div>
          {/if}
          <div
            tabindex="0"
            role="button"
            title={showingArchive ? $t('manager.unarchiveBooks') : $t('manager.archiveBooks')}
            class="transform-gpu {baseIconClasses}"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
            on:click={() => dispatch('archiveClick')}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={showingArchive ? faBoxOpen : faBoxArchive} />
          </div>
          <div
            tabindex="0"
            role="button"
            title={$t('manager.deleteBooks')}
            class="transform-gpu {baseIconClasses}"
            in:scale={inAnimationParams}
            out:scale={outAnimationParams}
            on:click={() => dispatch('removeClick')}
            on:keyup={activateOnKeyup}
          >
            <Fa icon={faTrash} />
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div
      title={$t('manager.cancelOperation')}
      class="mx-auto flex h-full transform-gpu items-center justify-center px-4 md:px-8 lg:max-w-4xl xl:max-w-none 2xl:max-w-6xl"
      in:scale={inAnimationParams}
      out:scale={outAnimationParams}
    >
      <Popover contentText={cancelTooltip} contentStyles={'padding: 0.75rem'} eventType="pointer">
        <div
          tabindex="0"
          role="button"
          on:click={() => dispatch('cancelReplication')}
          on:keyup={activateOnKeyup}
        >
          <Fa icon={faCircleXmark} class="cursor-pointer" />
        </div>
      </Popover>
      <progress class="mx-4 w-full" value={replicationProgress} max={replicationToProgress} />
      <div class="ml-4 min-w-fit whitespace-nowrap">
        {#if replicationToProgress > 0}
          <span class="tabular-nums mr-2">{Math.round((replicationProgress / replicationToProgress) * 100)}%</span>
        {/if}
        {replicationProgressRemaining}
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-badge {
    position: absolute;
    top: 0.55rem;
    right: 0.55rem;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: #f97316;
    box-shadow: 0 0 0 2px var(--menu-background, rgba(0, 0, 0, 0.4));
  }
</style>
