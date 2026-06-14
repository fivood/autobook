<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { faUpload } from '@fortawesome/free-solid-svg-icons';
  import BookCardList from '$lib/components/book-card/book-card-list.svelte';
  import FolderSidebar from '$lib/components/library-folders/folder-sidebar.svelte';
  import {
    folders$,
    bookFolders$,
    activeFolderFilter$,
    refreshFolders,
    addBooksToFolder,
    removeBooksFromFolder,
    clearBookFolderAssignments
  } from '$lib/data/library-folders';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import ExternalReadDialog from '$lib/components/external-read-dialog.svelte';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import { pxScreen } from '$lib/css-classes';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath } from '$lib/data/env';
  import { logger } from '$lib/data/logger';
  import { SortDirection, type SortOption } from '$lib/data/sort-types';
  import { ApiStorageHandler } from '$lib/data/storage/handler/api-handler';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import {
    booklistSortOptions$,
    cacheStorageData$,
    confirmStatisticsDeletion$,
    database,
    fileCountData$,
    hideExternalReadHint$,
    isOnline$,
    keepLocalStatisticsOnDeletion$,
    lastExportedTarget$,
    lastExportedTypes$,
    pendingLaunchFiles$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    showExternalPlaceholder$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
  import { cloneMutateSet } from '$lib/functions/clone-mutate-set';
  import { getDropEventFiles } from '$lib/functions/file-dom/get-drop-event-files';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { keyBy } from '$lib/functions/key-by';
  import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
  import { importBackup, importData, replicateData } from '$lib/functions/replication/replicator';
  import { throwIfAborted } from '$lib/functions/replication/replication-error';
  import {
    replicationProgress$,
    executeReplicate$,
    type ReplicationProgress
  } from '$lib/functions/replication/replication-progress';
  import { pluralize } from '$lib/functions/utils';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import pLimit from 'p-limit';
  import { combineLatest, map, Observable, share, Subject, switchMap, takeUntil } from 'rxjs';
  import { onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';

  const booksAreLoading$ = database.listLoading$.pipe(map((isLoading) => isLoading));

  const bookCards$: Observable<BookCardProps[]> = combineLatest([
    database.dataList$,
    database.bookmarks$,
    booklistSortOptions$
  ]).pipe(
    map(([dataList, bookmarks]) => {
      const sortProp = $booklistSortOptions$[$storageSource$];
      const isTitleSort = sortProp.property === 'title';

      if ($storageSource$ === StorageKey.BROWSER) {
        const bookmarkMap = keyBy(bookmarks, 'dataId');

        return [
          ...dataList
            .filter((d) => $showExternalPlaceholder$ || !d.isPlaceholder)
            .map((d) => ({
              ...d,
              ...bookmarkToProgress(bookmarkMap.get(d.id))
            }))
            .sort((card1: BookCardProps, card2: BookCardProps) =>
              sortBookCards(card1, card2, sortProp, isTitleSort)
            )
        ];
      }

      return [
        ...dataList.sort((card1: BookCardProps, card2: BookCardProps) =>
          sortBookCards(card1, card2, sortProp, isTitleSort)
        )
      ];
    }),
    share()
  );

  /** bookCards$ filtered by the active folder selection in the sidebar.
   * "all" → unchanged; "uncategorized" → only books with no folder; numeric
   * id → books assigned to that folder. */
  const filteredBookCards$: Observable<BookCardProps[]> = combineLatest([
    bookCards$,
    bookFolders$,
    activeFolderFilter$
  ]).pipe(
    map(([cards, bookFolders, filter]) => {
      if (filter === 'all') return cards;
      if (filter === 'uncategorized') {
        const assigned = new Set(bookFolders.map((bf) => bf.bookId));
        return cards.filter((c) => !assigned.has(c.id));
      }
      const folderId = Number(filter);
      if (!Number.isFinite(folderId)) return cards;
      const inFolder = new Set(
        bookFolders.filter((bf) => bf.folderId === folderId).map((bf) => bf.bookId)
      );
      return cards.filter((c) => inFolder.has(c.id));
    }),
    share()
  );

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let selectedBookIds: ReadonlySet<number> = new Set();
  let selectMode = false;
  let cancelToken = new AbortController();
  let cancelSignal = cancelToken.signal;
  let cancelTooltip = '';
  let isDragOver = false;
  let replicationProgress = 0;
  let replicationToProgress = 0;
  let replicationProgressRemaining = '~ ??:??:??';
  let replicationDone = new Subject<void>();
  let progressBase = 0;
  let executionStart: number;

  $: {
    if (!selectMode) {
      selectedBookIds = new Set();
    }
  }

  onDestroy(() => dialogManager.dialogs$.next([]));

  onMount(() => {
    refreshFolders().catch(() => {});
  });

  /** Book IDs to assign when the user drags onto a folder. If the dragged
   * book is part of the current selection, drag the whole selection;
   * otherwise drag just that one book. */
  function buildDragPayload(bookId: number): number[] {
    if (selectedBookIds.has(bookId)) return Array.from(selectedBookIds);
    return [bookId];
  }

  function onCardDragStart(ev: DragEvent, bookId: number) {
    if (!ev.dataTransfer) return;
    const ids = buildDragPayload(bookId);
    ev.dataTransfer.setData('application/x-autobook-book-ids', JSON.stringify(ids));
    ev.dataTransfer.effectAllowed = 'copy';
  }

  async function removeSelectedFromActiveFolder() {
    const filter = $activeFolderFilter$;
    if (filter === 'all' || filter === 'uncategorized') return;
    const folderId = Number(filter);
    if (!Number.isFinite(folderId)) return;
    await removeBooksFromFolder(Array.from(selectedBookIds), folderId);
    selectedBookIds = new Set();
  }

  async function addSelectedToFolder(folderId: number) {
    await addBooksToFolder(Array.from(selectedBookIds), folderId);
  }

  function bookmarkToProgress(b: BooksDbBookmarkData | undefined) {
    return b?.progress
      ? {
          progress: typeof b.progress === 'string' ? +b.progress.slice(0, -1) : b.progress,
          lastBookmarkModified: b.lastBookmarkModified || 0
        }
      : { progress: 0, lastBookmarkModified: 0 };
  }

  function sortBookCards(
    card1: BookCardProps,
    card2: BookCardProps,
    sortProp: SortOption,
    isTitleSort: boolean
  ) {
    const card1Prop = card1[sortProp.property] || (isTitleSort ? '' : 0);
    const card2Prop = card2[sortProp.property] || (isTitleSort ? '' : 0);

    let sortDiff = 0;

    if (sortProp.direction === SortDirection.ASC) {
      sortDiff = isTitleSort
        ? card1.title.localeCompare(card2.title, 'ja-JP', { numeric: true })
        : +card1Prop - +card2Prop;
    } else {
      sortDiff = isTitleSort
        ? card2.title.localeCompare(card1.title, 'ja-JP', { numeric: true })
        : +card2Prop - +card1Prop;
    }

    if (!sortDiff) {
      sortDiff = card1.title.localeCompare(card2.title, 'ja-JP', { numeric: true });
    }

    return sortDiff;
  }

  async function onBookClick(bookId: number) {
    if (!operationAllowed()) {
      return;
    }

    if (!selectMode) {
      dialogManager.dialogs$.next([
        {
          component: '<div/>',
          disableCloseOnClick: true
        }
      ]);

      let idToOpen = bookId;

      try {
        const bookItem = $bookCards$.find((book) => book.id === bookId);

        if (!bookItem) {
          throw new Error('未找到书籍标题');
        }

        const isForBrowser = $storageSource$ === StorageKey.BROWSER;
        const handler = getStorageHandler(
          window,
          $storageSource$,
          '',
          isForBrowser,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        if (!cacheStorageData$) {
          handler.clearData(false);
        }

        handler.startContext({
          id: isForBrowser ? bookItem.id : 0,
          title: bookItem.title,
          imagePath: bookItem.imagePath
        });

        idToOpen = await handler.prepareBookForReading();

        if (!$hideExternalReadHint$ && handler instanceof ApiStorageHandler) {
          const nextAction = await new Promise<string>((resolver) => {
            dialogManager.dialogs$.next([
              {
                component: ExternalReadDialog,
                props: { resolver },
                disableCloseOnClick: true
              }
            ]);
          });

          if (nextAction === 'cancel') {
            return;
          }

          if (nextAction === 'export') {
            selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
              set.add(bookId);
            });
            selectMode = true;

            await tick();

            return onReplicateData();
          }
        }

        dialogManager.dialogs$.next([]);
      } catch (error: any) {
        const message = `Error opening book: ${error.message}`;

        logger.warn(message);

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: '错误',
              message
            }
          }
        ]);

        return;
      }

      openBook(idToOpen);
      return;
    }

    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      if (set.has(bookId)) {
        set.delete(bookId);
        return;
      }
      set.add(bookId);
    });
  }

  function operationAllowed() {
    const connectivityPass = !(
      ($storageSource$ === StorageKey.GDRIVE || $storageSource$ === StorageKey.ONEDRIVE) &&
      !$isOnline$
    );

    if (!connectivityPass && !replicationToProgress) {
      const message = '此操作需要联网';

      logger.warn(message);

      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '失败',
            message
          }
        }
      ]);
    }

    return !replicationToProgress && connectivityPass;
  }

  function openBook(bookId: number) {
    if (!bookId) {
      return;
    }

    database.putLastItem(bookId);
    gotoBook(bookId);
  }

  async function gotoBook(id: number) {
    await goto(`${pagePath}/b?id=${id}`);
  }

  async function onFilesChange(fileList: FileList | File[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = `取消当前导入\n已导入的数据不会被删除`;

    initializeReplicationProgressData();

    const supportedExtRegex = /\.(?:htmlz|epub|txt|md|markdown)$/i;
    const errorTitle = '书籍导入失败';
    const expanded = await expandZipArchives(Array.from(fileList)).catch((err) => {
      logger.warn(`Error expanding zip: ${err.message}`);
      return Array.from(fileList);
    });
    const files = expanded.filter((f) => supportedExtRegex.test(f.name));

    if (!files.length) {
      resetProgress();

      showError(errorTitle, '文件必须是 HTMLZ、TXT、EPUB 或包含这些格式的 ZIP', '');
      return;
    }

    const error = await importData(
      document,
      getStorageHandler(
        window,
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      files,
      cancelSignal,
      $fileCountData$
    ).catch((catchedError) => catchedError.message);

    resetProgress();

    if (error) {
      showError(errorTitle, error, '书籍导入期间发生错误');
    }
  }

  $: if (browser && $pendingLaunchFiles$.length) {
    const paths = $pendingLaunchFiles$;
    pendingLaunchFiles$.next([]);
    importLaunchPaths(paths);
  }

  /** Read whitelisted launch paths via the fs plugin and run the normal import. */
  async function importLaunchPaths(paths: string[]) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const files = await Promise.all(
        paths.map(async (path) => {
          const data = await readFile(path);
          const name = path.split(/[\\/]/).pop() || 'book';
          return new File([data], name);
        })
      );
      await onFilesChange(files);
    } catch (err: any) {
      showError('书籍导入失败', err.message, '打开文件时发生错误');
    }
  }

  /** Expand .zip archives into the supported book files they contain. */
  async function expandZipArchives(list: File[]): Promise<File[]> {
    const out: File[] = [];

    for (const file of list) {
      if (!/\.zip$/i.test(file.name)) {
        out.push(file);
        continue;
      }

      const reader = new ZipReader(new BlobReader(file));

      try {
        const entries = await reader.getEntries();

        for (const entry of entries) {
          if (entry.directory || !entry.getData) continue;
          if (!/\.(?:htmlz|epub|txt|md|markdown)$/i.test(entry.filename)) continue;

          const name = entry.filename.split('/').pop() || entry.filename;
          // eslint-disable-next-line no-await-in-loop
          const blob = await entry.getData(new BlobWriter());
          out.push(new File([blob], name, { lastModified: file.lastModified }));
        }
      } finally {
        await reader.close();
      }
    }

    return out;
  }

  function showError(title: string, message: string, fallbackMessage: string) {
    const showReport = logger.errorCount > 1;

    logger.warn(message);

    dialogManager.dialogs$.next([
      {
        component: showReport ? LogReportDialog : MessageDialog,
        props: {
          title,
          message: showReport ? fallbackMessage : message
        }
      }
    ]);
  }

  function initializeReplicationProgressData() {
    replicationDone = new Subject<void>();
    replicationProgress$.pipe(takeUntil(replicationDone)).subscribe(updateProgress);
    replicationProgressRemaining = '~ ??:??:??';
    replicationProgress = 0;
    replicationToProgress = 1;
    executionStart = Date.now();

    logger.clearHistory();

    cancelToken = new AbortController();
    cancelSignal = cancelToken.signal;
  }

  function resetProgress() {
    replicationDone.next();
    replicationDone.complete();
    replicationToProgress = 0;
    replicationProgress = 0;
    cancelTooltip = '';
  }

  function onSelectAllBooks() {
    const bookCards = $bookCards$;
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      bookCards.forEach((x) => set.add(x.id));
    });
  }

  function backToCurrentBook() {
    const currentBookId = $currentBookId$;
    if (!currentBookId) return;
    gotoBook(currentBookId);
  }

  async function removeBooks(bookIds: number[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = `取消删除\n已删除的数据无法恢复`;

    initializeReplicationProgressData();

    const currentBookCount = $bookCards$.length;
    const handler = getStorageHandler(window, $storageSource$, '');
    const { error, deleted } = await handler.deleteBookData(
      $bookCards$.reduce((toDelete, card) => {
        if (bookIds.includes(card.id)) {
          toDelete.push(card.title);
        }
        return toDelete;
      }, [] as string[]),
      cancelSignal,
      $keepLocalStatisticsOnDeletion$
    );

    resetProgress();

    await tick();

    // Strip folder assignments for any book we just removed. deleted[] is
    // book IDs (numbers).
    await Promise.all(deleted.map((id: number) => clearBookFolderAssignments(id).catch(() => {})));

    if (deleted.length === currentBookCount) {
      selectMode = false;
    } else {
      selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
        deleted.forEach((deletedBookId) => set.delete(deletedBookId));
      });
    }

    if (error) {
      showError('删除失败', error, '删除期间发生错误');
    }
  }

  async function onImportBackup(file: File) {
    if (!operationAllowed()) {
      return;
    }

    const errorTitle = '导入失败';

    cancelTooltip = `Cancels the current Import\nAlready imported data will not be deleted`;

    initializeReplicationProgressData();

    if (!file.name.endsWith('.zip')) {
      resetProgress();

      showError(errorTitle, '无效文件 - 需要 zip 压缩包', '');
      return;
    }

    const error = await importBackup(
      getStorageHandler(
        window,
        StorageKey.BACKUP,
        undefined,
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      getStorageHandler(
        window,
        $storageSource$,
        '',
        $storageSource$ === StorageKey.BROWSER,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      ),
      file,
      cancelSignal
    ).catch((err) => err.message);

    resetProgress();

    if (error) {
      showError(errorTitle, error, '导入期间发生错误');
    }
  }

  function onDomainHintClick() {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: '旧域名',
          message:
            '您正在使用 ッツ 阅读器的旧域名 - 建议切换到 https://reader.ttsu.app 以避免问题并确保完整功能'
        },
        disableCloseOnClick: true
      }
    ]);
  }

  function onReplicateData() {
    dialogManager.dialogs$.next([{ component: BookExportDialog, disableCloseOnClick: true }]);
  }

  async function onDeleteStatistics() {
    const titles = $bookCards$
      .filter((card) => selectedBookIds.has(card.id))
      .map((book) => book.title);

    let wasCanceled = false;

    if ($confirmStatisticsDeletion$) {
      wasCanceled = await new Promise((resolver) => {
        dialogManager.dialogs$.next([
          {
            component: ConfirmDialog,
            props: {
              dialogHeader: '删除数据',
              dialogMessage: `This will delete all Statistics for the selected ${pluralize(
                titles.length,
                '书籍',
                false
              )} (which may include start and/or completion Data)\n\nExecute a one time Sync with an export behavior of "replace" and/or statistics merge mode of "replace" to apply deletions to other devices`,
              contentStyles: 'white-space: pre-line;',
              resolver
            }
          }
        ]);
      });
    }

    if (wasCanceled) {
      return;
    }

    cancelTooltip = `取消当前操作`;

    initializeReplicationProgressData();

    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let failed = 0;

    replicationProgress$.next({ progressBase: 1, maxProgress: titles.length });

    titles.forEach((title) => {
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);
            await database.deleteStatisticEntries([title], true);

            replicationProgress$.next({ progressToAdd: 1 });
          } catch (error) {
            handleErrorDuringReplication(error, `Error on deleting statistics for ${title}: `, [
              limiter
            ]);

            failed += 1;
          }
        })
      );
    });

    await Promise.all(tasks).catch(() => {});

    resetProgress();

    if (failed) {
      const errorMessage = `无法删除 ${pluralize(failed, '本书')} 的统计数据`;

      showError('删除失败', errorMessage, errorMessage);
    }
  }

  function updateProgress(replicationProgressData: ReplicationProgress) {
    if (cancelSignal.aborted) {
      return;
    }

    progressBase = replicationProgressData.progressBase || progressBase || 0;
    replicationToProgress = replicationProgressData.maxProgress || replicationToProgress || 0;

    if (replicationProgressData.skipStep) {
      const progressDiffToAdd =
        Math.ceil(replicationProgress / progressBase) * progressBase - replicationProgress;

      replicationProgress =
        Math.floor(
          (replicationProgress + (progressDiffToAdd || progressBase) + Number.EPSILON) * 1000
        ) / 1000;
    } else if (replicationProgressData.completeStep) {
      const progressDiffToAdd = Math.ceil(replicationProgress) - replicationProgress;

      replicationProgress =
        Math.floor((replicationProgress + progressDiffToAdd + Number.EPSILON) * 1000) / 1000;
    } else if (replicationProgressData.progressToAdd && replicationProgressData.progressToAdd > 0) {
      replicationProgress =
        Math.floor(
          (replicationProgress + replicationProgressData.progressToAdd + Number.EPSILON) * 1000
        ) / 1000;
    }

    if (replicationProgressData.progressToAdd) {
      const duration = (Date.now() - executionStart) / 1000;
      const processPerSecond = replicationProgress / duration;
      const remainingTime = (replicationToProgress - replicationProgress) / processPerSecond;

      replicationProgressRemaining =
        replicationToProgress > replicationProgress
          ? `~ ${getTimestamp(Math.ceil(remainingTime))}`
          : '~ 00:00:01';
    }
  }

  const replicator$ = executeReplicate$.pipe(
    switchMap(async () => {
      if (!operationAllowed()) {
        return;
      }

      cancelTooltip = '取消当前导出';

      initializeReplicationProgressData();

      const handlers = [$storageSource$, $lastExportedTarget$].map((storageType) =>
        getStorageHandler(
          window,
          storageType,
          '',
          $lastExportedTarget$ === StorageKey.BROWSER,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        )
      );
      const books = $bookCards$.filter((card) => selectedBookIds.has(card.id));
      const error = await replicateData(
        handlers[0],
        handlers[1],
        false,
        books.map((book) => ({ title: book.title, imagePath: book.imagePath })),
        $lastExportedTypes$,
        cancelSignal
      ).catch((err) => err.message);

      resetProgress();

      if (error) {
        showError('导出失败', error, '导出期间发生错误');
      }
    }),
    reduceToEmptyString()
  );

  function getTimestamp(seconds: number) {
    return seconds && Number.isFinite(seconds)
      ? new Date(seconds * 1000).toISOString().substr(11, 8)
      : '??:??:??';
  }
</script>

<svelte:head>
  <title>{formatPageTitle('书库管理')}</title>
</svelte:head>

{$replicator$ ?? ''}

<div class="elevation-4 fixed inset-x-0 top-0 z-10">
  <BookManagerHeader
    hasBookOpened={!!$currentBookId$}
    selectedCount={selectedBookIds.size}
    hasBooks={!!$bookCards$?.length}
    {cancelTooltip}
    {replicationProgress}
    {replicationToProgress}
    {replicationProgressRemaining}
    bind:selectMode
    on:selectAllClick={onSelectAllBooks}
    on:backToBookClick={backToCurrentBook}
    on:removeClick={() => removeBooks(Array.from(selectedBookIds))}
    on:filesChange={(ev) => onFilesChange(ev.detail)}
    on:domainHintClick={onDomainHintClick}
    on:cancelReplication={() => {
      if (!cancelSignal.aborted) {
        cancelToken.abort();
        replicationProgressRemaining = '正在取消 ...';
      }
    }}
    on:selectionToStatistics={() => {
      $preFilteredTitlesForStatistics$ = new Set(
        $bookCards$.filter((card) => selectedBookIds.has(card.id)).map((book) => book.title)
      );

      goto(`${pagePath}${mergeEntries.STATISTICS.routeId}`);
    }}
    on:deleteStatistics={onDeleteStatistics}
    on:replicateData={onReplicateData}
    on:importBackup={(ev) => onImportBackup(ev.detail)}
  />
</div>

<div class="flex min-h-screen pt-16 xl:pt-14">
  <FolderSidebar totalBookCount={$bookCards$?.length ?? 0} />
  <div
    tabindex="0"
    role="button"
    class="{pxScreen} relative flex-1 overflow-auto"
    on:dragenter={(ev) => {
      ev.preventDefault();
      if (ev.dataTransfer?.types?.includes('Files')) isDragOver = true;
    }}
    on:dragover={(ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    }}
    on:dragleave={(ev) => {
      if (ev.currentTarget === ev.target) isDragOver = false;
    }}
    on:dragend={() => (isDragOver = false)}
    on:drop|preventDefault={(ev) => {
      isDragOver = false;
      getDropEventFiles(ev).then(onFilesChange);
    }}
  >
  {#if isDragOver}
    <div
      class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-blue-500/10 border-4 border-dashed border-blue-400 rounded-lg"
    >
      <div class="text-xl font-semibold opacity-80">松开以导入书籍</div>
    </div>
  {/if}
  {#if selectMode && selectedBookIds.size && $folders$.length}
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span class="opacity-70">将选中的 {selectedBookIds.size} 本加入分类：</span>
      {#each $folders$ as folder (folder.id)}
        <button
          class="rounded-full border-2 border-gray-400 px-3 py-1 text-xs hover:bg-gray-400/20"
          on:click={() => addSelectedToFolder(folder.id)}
        >
          + {folder.name}
        </button>
      {/each}
      {#if $activeFolderFilter$ !== 'all' && $activeFolderFilter$ !== 'uncategorized'}
        <button
          class="rounded-full border-2 border-red-400 px-3 py-1 text-xs text-red-500 hover:bg-red-400/20"
          on:click={removeSelectedFromActiveFolder}
        >
          从当前分类移出
        </button>
      {/if}
    </div>
  {/if}
  {#if !$filteredBookCards$ || $booksAreLoading$}
    加载中...
  {:else if $filteredBookCards$.length}
    <BookCardList
      currentBookId={$currentBookId$}
      {selectedBookIds}
      bookCards={$filteredBookCards$}
      on:bookClick={(ev) => onBookClick(ev.detail.id)}
      on:removeBookClick={(ev) => removeBooks([ev.detail.id])}
      on:cardDragStart={(ev) => onCardDragStart(ev.detail.event, ev.detail.id)}
    />
  {:else if $activeFolderFilter$ !== 'all'}
    <div class="mt-20 text-center text-sm opacity-60">这个分类还是空的；拖书过来或框选后点上面的胶囊加入</div>
  {:else}
    <label
      class="group mx-auto mt-44 flex w-3/6 cursor-pointer flex-col items-center justify-center text-gray-400 text-opacity-40 hover:text-opacity-60 xl:w-3/12"
    >
      <div class="flex w-full justify-center transition-transform group-hover:scale-105">
        <Fa icon={faUpload} style="width: 100%; height: auto" />
      </div>
      <span class="mt-4 text-sm opacity-0 transition-opacity group-hover:opacity-100">
        点击添加书籍
      </span>
      <input
        type="file"
        accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,text/markdown,.md,.markdown,application/zip,.zip"
        multiple
        hidden
        use:inputFile={onFilesChange}
      />
    </label>
  {/if}
  </div>
</div>
