<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { faCheck, faUpload } from '@fortawesome/free-solid-svg-icons';
  import BookCardList from '$lib/components/book-card/book-card-list.svelte';
  import FolderSidebar from '$lib/components/library-folders/folder-sidebar.svelte';
  import {
    folders$,
    bookFolders$,
    activeFolderFilter$,
    refreshFolders,
    addBooksToFolder,
    findOrCreateLocalFolder,
    removeBooksFromFolder,
    clearBookFolderAssignments
  } from '$lib/data/library-folders';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import LoadingDialog from '$lib/components/loading-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath } from '$lib/data/env';
  import { logger } from '$lib/data/logger';
  import { SortDirection, type SortOption } from '$lib/data/sort-types';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { isTauri } from '$lib/data/env';
  import {
    booklistSortOptions$,
    cacheStorageData$,
    confirmStatisticsDeletion$,
    database,
    fileCountData$,
    keepLocalStatisticsOnDeletion$,
    lastExportedTarget$,
    lastExportedTypes$,
    libraryFilter$,
    pendingLaunchFiles$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    showExternalPlaceholder$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { t, tImmediate } from '$lib/i18n';
  import { detectBookFormat } from '$lib/functions/book-format';
  import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
  import { cloneMutateSet } from '$lib/functions/clone-mutate-set';
  import { getDropEventFiles } from '$lib/functions/file-dom/get-drop-event-files';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
  import { submitReport } from '$lib/functions/report-error';
  import {
    importBackup,
    importData,
    replicateData,
    type ImportedBook
  } from '$lib/functions/replication/replicator';
  import { throwIfAborted } from '$lib/functions/replication/replication-error';
  import {
    replicationProgress$,
    executeReplicate$,
    type ReplicationProgress
  } from '$lib/functions/replication/replication-progress';
  import { pluralize } from '$lib/functions/utils';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import pLimit from 'p-limit';
  import {
    combineLatest,
    defer,
    map,
    Observable,
    share,
    shareReplay,
    startWith,
    Subject,
    switchMap,
    takeUntil
  } from 'rxjs';
  import { onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';

  const booksAreLoading$ = database.listLoading$.pipe(map((isLoading) => isLoading));

  // IDB data.id → title map. Tauri FS card.id is stableIdFromTitle(title) (a
  // hash), but bookmark.dataId is the IDB book.id (autoincrement, e.g. 5).
  // The two id spaces never overlap, so any merge keyed on dataId/id always
  // misses. Bridge: bookmark.dataId → IDB data row → title, then match FS
  // cards by title. Re-fetches whenever books are added or removed.
  const idbTitleByDataId$ = database.dataListChanged$.pipe(
    startWith(undefined as unknown),
    switchMap(() =>
      defer(async () => {
        const db = await database.db;
        const records = await db.getAll('data');
        const m = new Map<number, string>();
        for (const r of records) m.set(r.id, r.title);
        return m;
      })
    ),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const bookCards$: Observable<BookCardProps[]> = combineLatest([
    database.dataList$,
    database.bookmarks$,
    booklistSortOptions$,
    idbTitleByDataId$
  ]).pipe(
    map(([dataList, bookmarks, _sortOpts, titleByDataId]) => {
      const sortProp = $booklistSortOptions$[$storageSource$];
      const isTitleSort = sortProp.property === 'title';
      const isBrowserSource = $storageSource$ === StorageKey.BROWSER;

      // Build title → bookmark map by joining bookmarks (keyed by IDB id)
      // through the IDB data store. Works for both BROWSER and Tauri FS:
      // browser-handler card.title === IDB data.title; tauri-fs-handler card
      // title is desanitizeFilename(dirName), which round-trips through the
      // same sanitizeFilename used at write time.
      const titleToBookmark = new Map<string, BooksDbBookmarkData>();
      for (const b of bookmarks) {
        const title = titleByDataId.get(b.dataId);
        if (title) titleToBookmark.set(title, b);
      }

      return [
        ...dataList
          .filter((d) => !isBrowserSource || $showExternalPlaceholder$ || !d.isPlaceholder)
          .map((d) => {
            const bm = titleToBookmark.get(d.title);
            // No IDB bookmark for this title? Keep handler-provided values
            // (tauri-fs-handler reads progress / lastBookmarkModified from
            // on-disk `progress_*.json` filename when the book was synced
            // but not opened locally).
            if (!bm) return d;
            return { ...d, ...bookmarkToProgress(bm, d.characters || 0) };
          })
          .sort((card1: BookCardProps, card2: BookCardProps) =>
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
    activeFolderFilter$,
    libraryFilter$
  ]).pipe(
    map(([cards, bookFolders, filter, libFilter]) => {
      let result = cards;
      if (filter === 'uncategorized') {
        const assigned = new Set(bookFolders.map((bf) => bf.bookId));
        result = result.filter((c) => !assigned.has(c.id));
      } else if (filter !== 'all') {
        const folderId = Number(filter);
        if (Number.isFinite(folderId)) {
          const inFolder = new Set(
            bookFolders.filter((bf) => bf.folderId === folderId).map((bf) => bf.bookId)
          );
          result = result.filter((c) => inFolder.has(c.id));
        }
      }

      if (libFilter.formats.length) {
        const allowed = new Set(libFilter.formats);
        result = result.filter((c) => allowed.has(detectBookFormat(c.title)));
      }

      if (libFilter.completion !== 'all') {
        result = result.filter((c) => {
          // bookmarkToProgress normalizes to 0–1; "done" is anything >= 0.995
          // to absorb floating-point drift in the final-bookmark calculation.
          const p = c.progress || 0;
          if (libFilter.completion === 'unread') return p === 0;
          if (libFilter.completion === 'done') return p >= 0.995;
          return p > 0 && p < 0.995;
        });
      }

      return result;
    }),
    share()
  );

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let selectedBookIds: ReadonlySet<number> = new Set();
  let selectMode = false;
  /** True while a book-click's prepareBookForReading is in flight. Guards
   * against double-click stacking a second loading dialog / prepare. */
  let openingBook = false;
  /** Free-text title search. Deliberately NOT persisted — users
   * expect to see their full library on next open. */
  let searchQuery = '';
  // Applied query — the `visibleBookCards` filter runs off this rather than
  // `searchQuery` directly, so a fast typist doesn't re-scan the whole
  // library on every keystroke. 120ms is under the perceptual threshold for
  // "instant" while collapsing the burst into a single filter pass.
  let debouncedSearchQuery = '';
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  $: {
    clearTimeout(searchDebounceTimer);
    const q = searchQuery;
    if (!q) {
      debouncedSearchQuery = '';
    } else {
      searchDebounceTimer = setTimeout(() => {
        debouncedSearchQuery = q;
      }, 120);
    }
  }
  $: visibleBookCards = (() => {
    const cards = $filteredBookCards$ || [];
    const q = debouncedSearchQuery.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => c.title.toLowerCase().includes(q));
  })();
  let cancelToken = new AbortController();
  let cancelSignal = cancelToken.signal;
  let cancelTooltip = '';
  let isDragOver = false;
  let fileInputEl: HTMLInputElement | undefined;
  let replicationProgress = 0;
  let replicationToProgress = 0;
  let replicationProgressRemaining = tImmediate('manager.progressPreparing');
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
    const ids = Array.from(selectedBookIds);
    await removeBooksFromFolder(ids, folderId);
    selectedBookIds = new Set();
    activeFolderFilter$.next('uncategorized');
    flashToast(tImmediate('manager.toast.removedFromFolder', { n: ids.length }));
  }

  async function addSelectedToFolder(folderId: number) {
    const ids = Array.from(selectedBookIds);
    await addBooksToFolder(ids, folderId);
    flashToast(tImmediate('manager.toast.addedToFolder', { n: ids.length }));
  }

  let toastMessage = '';
  let toastVisible = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function flashToast(message: string) {
    toastMessage = message;
    toastVisible = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible = false;
    }, 1800);
  }

  function bookmarkToProgress(
    b: BooksDbBookmarkData | undefined,
    bookCharCount: number
  ) {
    if (!b) return { progress: 0, lastBookmarkModified: 0 };
    // Normalize to 0–1. Three cases observed in IDB across versions:
    //   1. New (≥1.5): bookmark.progress is a 0–1 number
    //   2. Legacy: bookmark.progress is a "45%" string
    //   3. Very old: no progress field at all — only exploredCharCount.
    //      Without the fallback below, finished books from old versions
    //      keep showing 0% on hover / 0%-wide progress bar.
    let raw: number | undefined;
    if (b.progress != null) {
      raw = typeof b.progress === 'string' ? +b.progress.slice(0, -1) / 100 : b.progress;
    } else if (b.exploredCharCount && bookCharCount > 0) {
      raw = b.exploredCharCount / bookCharCount;
    }
    if (raw == null || Number.isNaN(raw)) {
      return { progress: 0, lastBookmarkModified: b.lastBookmarkModified || 0 };
    }
    return {
      progress: Math.max(0, Math.min(1, raw)),
      lastBookmarkModified: b.lastBookmarkModified || 0
    };
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
      // A second click while the first open is still preparing must not
      // stack another dialog — the loading dialog also blocks the click,
      // but guard here anyway so a double-click can't fire two prepares.
      if (openingBook) return;
      openingBook = true;

      dialogManager.dialogs$.next([
        {
          component: LoadingDialog,
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

        dialogManager.dialogs$.next([]);
      } catch (error: any) {
        const message = tImmediate('errors.openBook', { detail: error.message });

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

        openingBook = false;
        return;
      }

      openingBook = false;
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
    const connectivityPass = true;

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

  /**
   * Category path for an imported file, or '' when it carries no directory.
   *
   * `webkitRelativePath` is `<picked dir>/<sub…>/<file>`; the first segment is
   * the folder the user pointed at, which is the same for every file in the
   * import and so says nothing — drop it along with the filename. What is
   * left mirrors the tree the user chose to build, at whatever depth they
   * built it. Files from a plain multi-select (or unpacked from a zip) have no
   * relative path and stay uncategorized.
   */
  function categoryPathOf(file: File): string {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!rel) return '';
    return rel.split('/').slice(1, -1).join('/');
  }

  /** Mirror the imported directory tree into library categories. */
  async function assignImportedFolders(imported: ImportedBook[]) {
    const byPath = new Map<string, number[]>();
    for (const { file, id } of imported) {
      const path = categoryPathOf(file);
      if (!path) continue;
      const ids = byPath.get(path);
      if (ids) ids.push(id);
      else byPath.set(path, [id]);
    }
    // Grouped by path so each folder is resolved and refreshed once, not once
    // per book — refreshFolders re-reads both stores every call.
    for (const [path, ids] of byPath) {
      try {
        const folder = await findOrCreateLocalFolder(path);
        if (folder) await addBooksToFolder(ids, folder.id);
      } catch (err: any) {
        // The books themselves imported fine; losing a category assignment is
        // not worth failing the import over.
        logger.warn(`folder assignment failed for ${path}: ${err?.message}`);
      }
    }
  }

  async function onFilesChange(fileList: FileList | File[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = tImmediate('manager.cancelImport');

    initializeReplicationProgressData();

    const supportedExtRegex = /\.(?:htmlz|epub|txt|md|markdown|mobi|azw3?|pdf|cbz|cbr|cb7|cbt)$/i;
    const errorTitle = '书籍导入失败';
    const expanded = await expandZipArchives(Array.from(fileList)).catch((err) => {
      logger.warn(`Error expanding zip: ${err.message}`);
      return Array.from(fileList);
    });
    const files = expanded.filter((f) => supportedExtRegex.test(f.name));

    if (!files.length) {
      resetProgress();

      showError(
        errorTitle,
        '文件必须是 EPUB / HTMLZ / TXT / MD / Markdown / MOBI / AZW / AZW3 / PDF / CBZ / CBR / CB7 / CBT，或包含这些格式的 ZIP',
        ''
      );
      return;
    }

    const result = await importData(
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
    ).catch((catchedError) => ({ error: catchedError.message as string, imported: [] }));

    const error = result.error;

    await assignImportedFolders(result.imported);

    resetProgress();

    if (error) {
      // Auto-submit telemetry for MOBI/AZW import failures so we can see how
      // often Calibre / native parser hangs in the wild.
      const hasMobi = files.some((f) => /\.(mobi|azw3?)$/i.test(f.name));
      if (hasMobi) {
        submitReport({ type: 'import', message: error, context: { filenames: files.map((f) => f.name) } }).catch(
          () => undefined
        );
      }
      showError(errorTitle, error, '书籍导入期间发生错误');
    } else {
      // Large-file hint: a big comic/scanned-PDF imported into the browser
      // (IndexedDB) store bloats it and slows every book-list refresh. When a
      // Tauri filesystem is available, nudge the user to switch instead of
      // silently changing their chosen storage source.
      const largeFileCount = files.filter((f) => f.size > 100 * 1024 * 1024).length;
      if (largeFileCount > 0 && $storageSource$ === StorageKey.BROWSER && isTauri()) {
        flashToast(
          `检测到 ${largeFileCount} 个超过 100MB 的大文件，建议在设置中启用「外部文件存储」以节省浏览器存储`
        );
      }
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
          if (!/\.(?:htmlz|epub|txt|md|markdown|mobi|azw3?|pdf|cbz|cbr|cb7|cbt)$/i.test(entry.filename)) continue;

          const name = entry.filename.split('/').pop() || entry.filename;
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

  /** Card X / multi-select "remove" inside a folder view: only detach from the
   * current folder, don't delete the book. Library-wide views (全部 / 未分类)
   * still delete. */
  async function handleRemove(bookIds: number[]) {
    const filter = $activeFolderFilter$;
    if (filter !== 'all' && filter !== 'uncategorized') {
      const folderId = Number(filter);
      if (Number.isFinite(folderId)) {
        await removeBooksFromFolder(bookIds, folderId);
        selectedBookIds = new Set();
        flashToast(tImmediate('manager.toast.removedFromCurrentFolder', { n: bookIds.length }));
        return;
      }
    }
    await removeBooks(bookIds);
  }

  async function removeBooks(bookIds: number[]) {
    if (!operationAllowed()) {
      return;
    }

    cancelTooltip = tImmediate('manager.cancelDelete');

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

    cancelTooltip = tImmediate('manager.cancelImport');

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
              dialogHeader: tImmediate('manager.deleteStatisticsConfirm.header'),
              dialogMessage: tImmediate('manager.deleteStatisticsConfirm.body', { n: titles.length }),
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

    cancelTooltip = tImmediate('manager.cancelOperation');

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

      const eta = getTimestamp(Math.ceil(remainingTime));
      replicationProgressRemaining =
        replicationToProgress > replicationProgress
          ? (eta === tImmediate('manager.progressPreparing') ? eta : `~ ${eta}`)
          : '~ 00:00:01';
    }
  }

  const replicator$ = executeReplicate$.pipe(
    switchMap(async () => {
      if (!operationAllowed()) {
        return;
      }

      cancelTooltip = tImmediate('manager.cancelExport');

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
      : tImmediate('manager.progressPreparing');
  }
</script>

<svelte:head>
  <title>{formatPageTitle($t('pageTitle.manage'))}</title>
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
    on:removeClick={() => handleRemove(Array.from(selectedBookIds))}
    on:filesChange={(ev) => onFilesChange(ev.detail)}
    on:domainHintClick={onDomainHintClick}
    on:cancelReplication={() => {
      if (!cancelSignal.aborted) {
        cancelToken.abort();
        replicationProgressRemaining = tImmediate('manager.progressCanceling');
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
  <FolderSidebar
    totalBookCount={$bookCards$?.length ?? 0}
    on:booksAddedToFolder={({ detail }) => flashToast(tImmediate('manager.toast.addedToFolder', { n: detail.count }))}
  />
  <!-- svelte-ignore a11y-no-static-element-interactions — this is the library
       drop target; drag-and-drop is pointer-only, so no keyboard role applies. -->
  <div
    class="px-4 md:px-8 mx-auto w-full relative flex-1 overflow-auto"
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
          class="rounded-full border-2 border-current/40 px-3 py-1 text-xs hover-soft"
          on:click={() => addSelectedToFolder(folder.id)}
        >
          + {folder.name}
        </button>
      {/each}
      {#if $activeFolderFilter$ !== 'all' && $activeFolderFilter$ !== 'uncategorized'}
        <button
          class="rounded-full border-2 border-red-400 px-3 py-1 text-xs text-danger hover:bg-red-400/20"
          on:click={removeSelectedFromActiveFolder}
        >
          从当前分类移出
        </button>
      {/if}
    </div>
  {/if}
  <div class="mb-3 flex items-center gap-2">
    <div class="relative flex-1 max-w-md">
      <input
        type="search"
        placeholder={$t('library.search.placeholder')}
        class="library-search w-full"
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100"
          on:click={() => (searchQuery = '')}
          title={$t('library.search.clear')}
        >✕</button>
      {/if}
    </div>
    {#if visibleBookCards && $filteredBookCards$ && visibleBookCards.length !== $filteredBookCards$.length}
      <span class="text-xs opacity-60">
        {visibleBookCards.length} / {$filteredBookCards$.length}
      </span>
    {/if}
  </div>
  {#if !$filteredBookCards$ || $booksAreLoading$}
    加载中...
  {:else if visibleBookCards.length}
    <BookCardList
      currentBookId={$currentBookId$}
      {selectedBookIds}
      bookCards={visibleBookCards}
      on:bookClick={(ev) => onBookClick(ev.detail.id)}
      on:removeBookClick={(ev) => handleRemove([ev.detail.id])}
      on:cardDragStart={(ev) => onCardDragStart(ev.detail.event, ev.detail.id)}
    />
  {:else if $activeFolderFilter$ !== 'all'}
    <div class="mt-20 text-center text-sm opacity-60">这个分类还是空的；拖书过来或框选后点上面的胶囊加入</div>
  {:else}
    <div
      class="mx-auto mt-44 flex w-3/6 flex-col items-center justify-center text-gray-400 text-opacity-40 hover:text-opacity-60 xl:w-3/12"
    >
      <button
        type="button"
        class="flex w-full cursor-pointer flex-col items-center justify-center"
        on:click={() => fileInputEl?.click()}
      >
        <div class="flex w-full justify-center transition-transform">
          <Fa icon={faUpload} style="width: 100%; height: auto" />
        </div>
        <span class="mt-4 text-sm opacity-60">
          点击添加书籍
        </span>
      </button>
      <input
        type="file"
        accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,text/markdown,.md,.markdown,.mobi,.azw,.azw3,application/pdf,.pdf,.cbz,.cbr,.cb7,.cbt,application/zip,.zip"
        multiple
        hidden
        bind:this={fileInputEl}
        use:inputFile={onFilesChange}
      />
    </div>
  {/if}
  </div>
</div>

{#if toastVisible}
  <div
    class="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 transform"
    style="transition: opacity 200ms ease;"
  >
    <div
      class="flex items-center gap-2 rounded-full bg-menu px-4 py-2 text-menu shadow-lg"
    >
      <Fa icon={faCheck} />
      <span class="text-sm">{toastMessage}</span>
    </div>
  </div>
{/if}
