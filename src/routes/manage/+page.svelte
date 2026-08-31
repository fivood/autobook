<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { faCheck, faSquareCheck, faSquareMinus, faUpload } from '@fortawesome/free-solid-svg-icons';
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
  import { asBookCardId, type BookCardId } from '$lib/data/book-id';
  import {
    ARCHIVED_FILTER,
    archiveBooks,
    archivedTitles$,
    clearArchiveForTitles,
    refreshArchive,
    unarchiveBooks
  } from '$lib/data/library-archive';
  import BookManagerHeader from '$lib/components/book-card/book-manager-header.svelte';
  import BookExportDialog from '$lib/components/book-export/book-export-dialog.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import LoadingDialog from '$lib/components/loading-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import type { BooksDbBookData, BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
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
    lastExportedTarget$,
    lastExportedTypes$,
    libraryFilter$,
    pendingLaunchFiles$,
    readingGoalsMergeMode$,
    replicationSaveBehavior$,
    showExternalPlaceholder$,
    vaultSyncRoot$,
    statisticsMergeMode$
  } from '$lib/data/store';
  import { t, tImmediate } from '$lib/i18n';
  import { detectBookFormat } from '$lib/functions/book-format';
  import { categoryOfPath, planVaultSync, readVaultFiles } from '$lib/functions/vault-sync';
  import { vaultSyncLastError$ } from '$lib/data/store';
  import { formatTextSource, getEditableTextFormat } from '$lib/functions/file-loaders/text-source';
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
    libraryFilter$,
    archivedTitles$
  ]).pipe(
    map(([cards, bookFolders, filter, libFilter, archived]) => {
      // Archived books are hidden from every view except the archive itself —
      // that is the whole point of putting a book away.
      let result =
        filter === ARCHIVED_FILTER
          ? cards.filter((c) => archived.has(c.title))
          : cards.filter((c) => !archived.has(c.title));
      if (filter === 'uncategorized') {
        const assigned = new Set(bookFolders.map((bf) => bf.bookId));
        result = result.filter((c) => !assigned.has(c.id));
      } else if (filter !== 'all' && filter !== ARCHIVED_FILTER) {
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

  let selectedBookIds: ReadonlySet<BookCardId> = new Set();
  let selectMode = false;
  /** Last card clicked without shift — the other end of a shift-click range. */
  let selectionAnchorId: BookCardId | undefined;
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
    refreshArchive().catch(() => {});
    refreshFolders()
      // Once per library visit, after folders are loaded so newly synced books
      // land in their categories immediately. Failure is logged inside.
      .then(() => runVaultSync())
      .catch(() => {});
  });

  /** Book IDs to assign when the user drags onto a folder. If the dragged
   * book is part of the current selection, drag the whole selection;
   * otherwise drag just that one book. */
  function buildDragPayload(bookId: BookCardId): BookCardId[] {
    if (selectedBookIds.has(bookId)) return Array.from(selectedBookIds);
    return [bookId];
  }

  function onCardDragStart(ev: DragEvent, bookId: BookCardId) {
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

  /** Archived books that actually exist in this library, as card ids. */
  $: archivedCardIds = new Set(
    ($bookCards$ || []).filter((card) => $archivedTitles$.has(card.title)).map((card) => card.id)
  );

  $: visibleLibraryCount = Math.max(0, ($bookCards$?.length ?? 0) - archivedCardIds.size);

  /** Every card the current source knows about, archived or not. */
  $: shelfCardIds = new Set(($bookCards$ || []).map((card) => card.id));

  /** Card ids → titles, since the archive is keyed by title. */
  function titlesForIds(ids: Iterable<number>): string[] {
    const wanted = new Set(ids);
    return ($bookCards$ || []).filter((card) => wanted.has(card.id)).map((card) => card.title);
  }

  /**
   * Put the selection away, or bring it back when the archive is what's on
   * screen. One button rather than two: the archive view is the only place
   * un-archiving makes sense, and the only place archiving does not.
   */
  async function toggleArchiveForSelection() {
    const titles = titlesForIds(selectedBookIds);
    if (!titles.length) return;
    const restoring = $activeFolderFilter$ === ARCHIVED_FILTER;
    // Leave select mode before the await, not after. The books vanish from
    // the shelf as soon as the archive store updates, while the header still
    // said "selecting" for the rest of the operation — and a click on a card
    // in that window opened the book instead of ticking it.
    selectedBookIds = new Set();
    selectMode = false;
    if (restoring) {
      await unarchiveBooks(titles);
    } else {
      await archiveBooks(titles);
    }
    flashToast(
      tImmediate(restoring ? 'manager.toast.unarchived' : 'manager.toast.archived', {
        n: titles.length
      })
    );
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

  async function onBookClick(bookId: BookCardId, shiftKey = false, toggleKey = false) {
    if (!operationAllowed()) {
      return;
    }

    // Ctrl/Cmd- or shift-clicking a book is a selection gesture in every file
    // manager there is, so it starts the mode instead of opening the book.
    // Picking 30 books used to mean finding the toggle in the header first,
    // then 30 separate clicks.
    if (!selectMode && (shiftKey || toggleKey)) {
      selectMode = true;
      selectionAnchorId = bookId;
      selectedBookIds = new Set([bookId]);
      return;
    }

    if (selectMode && shiftKey && selectionAnchorId !== undefined) {
      selectRangeTo(bookId);
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

      // The reader is addressed by the IDB row id, which is a different space
      // from the card id we were clicked with — prepareBookForReading is the
      // conversion. Seeded with 0 rather than bookId to make that explicit;
      // every path that reaches openBook() assigns it first.
      let idToOpen = 0;

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

    selectionAnchorId = bookId;
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      if (set.has(bookId)) {
        set.delete(bookId);
        return;
      }
      set.add(bookId);
    });
  }

  /**
   * Live result of a rubber-band drag; the list has already folded in the
   * pre-drag selection when a modifier was held. A plain box replaces the
   * selection, which is what a file manager does — dragging a fresh box is
   * how you start over.
   */
  function onMarqueeSelect(ids: BookCardId[]) {
    selectedBookIds = new Set(ids);
    selectionAnchorId = ids[ids.length - 1] ?? selectionAnchorId;
  }

  /** Shift-click: add every visible card between the anchor and this one. */
  function selectRangeTo(bookId: BookCardId) {
    const cards = visibleBookCards;
    const from = cards.findIndex((card) => card.id === selectionAnchorId);
    const to = cards.findIndex((card) => card.id === bookId);
    if (from === -1 || to === -1) return;
    const [start, end] = from <= to ? [from, to] : [to, from];
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      for (let i = start; i <= end; i += 1) set.add(cards[i].id);
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
    const byPath = new Map<string, BookCardId[]>();
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

  // ponytail: vault sync lives here because the import pipeline, the delete
  // pipeline, the progress bar and the dialog manager all already do. Worth
  // extracting together with those if this file is ever split.
  let vaultSyncing = false;

  /** Books that mirror a file under the current sync root. */
  async function syncedBooks(): Promise<BooksDbBookData[]> {
    const db = await database.db;
    const all = await db.getAll('data');
    return all.filter((b) => typeof b.sourcePath === 'string' && b.sourcePath);
  }

  /**
   * Pull the sync root into the library. One-way: the files win, and nothing
   * is ever written back to them.
   */
  async function runVaultSync(manual = false) {
    const root = $vaultSyncRoot$.trim();
    if (!root || vaultSyncing || !isTauri()) return;
    vaultSyncing = true;
    vaultSyncLastError$.next('');
    try {
      const [files, books] = await Promise.all([readVaultFiles(root), syncedBooks()]);
      const plan = planVaultSync(
        files,
        books.map((b) => ({ id: b.id, sourcePath: b.sourcePath as string, sourceText: b.sourceText }))
      );

      const db = await database.db;

      // Edited in the vault: re-render in place so reading progress, folder
      // membership and highlights all survive.
      for (const { book, content } of plan.changed) {
        const current = await db.get('data', book.id);
        if (!current) continue;
        const format = getEditableTextFormat(current);
        if (!format) continue;
        const formatted = formatTextSource(content, format);
        await db.put('data', {
          ...current,
          sourceText: content,
          elementHtml: formatted.elementHtml,
          characters: formatted.characters,
          sections: formatted.sections,
          lastBookModified: Date.now()
        });
      }

      // Moved or renamed with the content untouched: only the path and the
      // category change.
      for (const { book, path } of plan.moved) {
        const current = await db.get('data', book.id);
        if (!current) continue;
        await db.put('data', { ...current, sourcePath: path });
        await reassignVaultCategory(asBookCardId(current.id), path);
      }

      let importedCount = 0;
      let importError: string | undefined;
      if (plan.added.length) {
        const res = await importVaultFiles(plan.added);
        importedCount = res.imported;
        importError = res.error;
      }

      // Deletions mirror the vault, but only for books that would cost the
      // user nothing. A rename the content match failed to catch looks exactly
      // like a deletion, so anything carrying reading progress or highlights
      // is left alone and reported instead.
      const removable: BooksDbBookData[] = [];
      const kept: BooksDbBookData[] = [];
      for (const orphan of plan.removed) {
        const current = await db.get('data', orphan.id);
        if (!current) continue;
        const hlCount = await db.countFromIndex('highlight', 'dataId', current.id);
        const read = (current.lastBookOpen || 0) > 0;
        (hlCount || read ? kept : removable).push(current);
      }
      if (removable.length) await removeBooks(removable.map((b) => asBookCardId(b.id)));

      if (plan.changed.length || plan.moved.length || plan.added.length || removable.length) {
        await refreshFolders();
        database.dataListChanged$.next(undefined as any);
      }

      if (kept.length) {
        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: tImmediate('vaultSync.keptTitle'),
              message: tImmediate('vaultSync.keptMessage', {
                titles: kept.map((b) => b.title).join('\n')
              })
            }
          }
        ]);
      } else if (importError) {
        // Not gated on `manual`: nothing ever passes it. This sync only runs
        // automatically, so its whole toast/dialog layer is unreachable and a
        // failure would otherwise leave no trace outside logger.warn. Same
        // treatment as the reading-time sync — state the reason in
        // 设置 → 数据 rather than interrupting with a dialog.
        vaultSyncLastError$.next(
          tImmediate('vaultSync.partialMessage', {
            imported: importedCount,
            planned: plan.added.length,
            detail: importError
          })
        );
      } else if (manual) {
        flashToast(
          tImmediate('vaultSync.done', {
            changed: plan.changed.length + plan.moved.length,
            added: importedCount,
            removed: removable.length
          })
        );
      }
    } catch (err: any) {
      logger.warn(`vault sync failed: ${err?.message || err}`);
      vaultSyncLastError$.next(err?.message || String(err));
      if (manual) showError(tImmediate('vaultSync.failedTitle'), err?.message || String(err), '');
    } finally {
      vaultSyncing = false;
    }
  }

  /**
   * Import notes the library has never seen, tagging each with its path.
   *
   * Returns how many actually landed plus the failure reason, if any.
   * `importData` reports failure by *returning* `{error}` rather than
   * throwing, so the enclosing try/catch in syncVault never saw it: the sync
   * went on to announce 「同步完成：新增 5」 using plan.added.length — the
   * number it meant to add — while none of the five had imported.
   */
  async function importVaultFiles(
    added: { path: string; content: string }[]
  ): Promise<{ imported: number; error?: string }> {
    const files = added.map(
      (f) => new File([f.content], f.path.split('/').pop() || 'note.md', { type: 'text/plain' })
    );
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
      cancelSignal
    ).catch((err) => ({ error: err.message as string, imported: [] as ImportedBook[] }));
    resetProgress();

    const db = await database.db;
    for (let i = 0; i < result.imported.length; i += 1) {
      const entry = result.imported[i];
      const source = added[files.indexOf(entry.file)];
      if (!source) continue;
      // importData returns the library-card id; the row we need to stamp is
      // keyed by the IDB id, so find it by title rather than by that number.
      const row = (await db.getAll('data')).find((b) => b.title === entry.file.name && !b.sourcePath);
      if (row) await db.put('data', { ...row, sourcePath: source.path });
      await reassignVaultCategory(entry.id, source.path);
    }
    if (result.error) logger.warn(`vault import: ${result.error}`);
    return { imported: result.imported.length, error: result.error };
  }

  /** Put a synced book in the folder matching its directory, and only there. */
  async function reassignVaultCategory(cardId: BookCardId, path: string) {
    const category = categoryOfPath(path);
    for (const bf of $bookFolders$.filter((b) => b.bookId === cardId)) {
      const folder = $folders$.find((f) => f.id === bf.folderId);
      if (folder?.source === 'local') await removeBooksFromFolder([cardId], folder.id);
    }
    if (!category) return;
    const folder = await findOrCreateLocalFolder(category);
    if (folder) await addBooksToFolder([cardId], folder.id);
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
    // errorCount is per-operation — initializeReplicationProgressData calls
    // logger.clearHistory() first — so `> 1` really does mean "several things
    // failed in this one run", and escalating to the log report is right.
    // What was wrong is that it *replaced* the reason: LogReportDialog renders
    // nothing but `message`, so a 3-file import failure showed one generic
    // sentence and three buttons, with the per-file causes reachable only by
    // downloading a report. The report is an addition, not a substitute.
    const showReport = logger.errorCount > 1;

    logger.warn(message);

    dialogManager.dialogs$.next([
      {
        component: showReport ? LogReportDialog : MessageDialog,
        props: {
          title,
          message: message || fallbackMessage
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

  /**
   * Select every card the reader can actually see, and clear when they are
   * already all selected.
   *
   * This used to read `$bookCards$` — the whole library, before the folder,
   * format, completion and search filters. Measured on a search that matched
   * nothing: 0 cards on screen, 2 books selected. The next click could have
   * been 删除.
   */
  function onSelectAllBooks() {
    const cards = visibleBookCards;
    if (!cards.length) return;
    if (allVisibleSelected) {
      selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
        cards.forEach((card) => set.delete(card.id));
      });
      return;
    }
    selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
      cards.forEach((card) => set.add(card.id));
    });
  }

  $: hiddenSelectedCount = (() => {
    if (!selectedBookIds.size) return 0;
    const visible = new Set(visibleBookCards.map((card) => card.id));
    let hidden = 0;
    selectedBookIds.forEach((id) => {
      if (!visible.has(id)) hidden += 1;
    });
    return hidden;
  })();

  $: allVisibleSelected =
    visibleBookCards.length > 0 && visibleBookCards.every((card) => selectedBookIds.has(card.id));

  function onManageKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === 'Escape' && selectMode) {
      selectMode = false;
      event.preventDefault();
    } else if (event.key === 'a' && (event.ctrlKey || event.metaKey) && selectMode) {
      onSelectAllBooks();
      event.preventDefault();
    }
  }

  function backToCurrentBook() {
    const currentBookId = $currentBookId$;
    if (!currentBookId) return;
    gotoBook(currentBookId);
  }

  /** Card X / multi-select "remove" inside a folder view: only detach from the
   * current folder, don't delete the book. Library-wide views (全部 / 未分类)
   * still delete. */
  async function handleRemove(bookIds: BookCardId[]) {
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
    const titlesToDelete = $bookCards$.reduce((toDelete, card) => {
      if (bookIds.includes(card.id)) {
        toDelete.push(card.title);
      }
      return toDelete;
    }, [] as string[]);
    const { error, deleted } = await handler.deleteBookData(titlesToDelete, cancelSignal);

    resetProgress();

    await tick();

    // deleteBookData reports the cards it removed, so these are card ids —
    // the same space bookFolder is keyed by. Tagged here rather than branding
    // the handler's return, which would spread through every storage source.
    await Promise.all(
      deleted.map((id: number) => clearBookFolderAssignments(asBookCardId(id)).catch(() => {}))
    );
    // Unlike reading records, an archive flag with no book is meaningless —
    // and worse, it would silently hide the book if it were re-imported.
    await clearArchiveForTitles(titlesToDelete).catch(() => {});

    if (deleted.length === currentBookCount) {
      selectMode = false;
    } else {
      selectedBookIds = cloneMutateSet(selectedBookIds, (set) => {
        deleted.forEach((deletedBookId: number) => set.delete(asBookCardId(deletedBookId)));
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

<svelte:window on:keydown={onManageKeydown} />

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
    {hiddenSelectedCount}
    on:backToBookClick={backToCurrentBook}
    showingArchive={$activeFolderFilter$ === ARCHIVED_FILTER}
    on:removeClick={() => handleRemove(Array.from(selectedBookIds))}
    on:archiveClick={toggleArchiveForSelection}
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
    totalBookCount={visibleLibraryCount}
    archivedCount={archivedCardIds.size}
    archivedBookIds={archivedCardIds}
    shelfBookIds={shelfCardIds}
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
  <!--
    The selection bar lives here rather than in the top bar: multi-select is a
    library-only mode, and the header is shared chrome. It also puts 全选 an
    inch from the books instead of at the far edge of the window.
  -->
  {#if selectMode}
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded border border-current/30 px-3 py-1 text-xs hover-soft"
        title={allVisibleSelected ? $t('manager.selectNone') : $t('manager.selectAll')}
        on:click={onSelectAllBooks}
      >
        <Fa icon={allVisibleSelected ? faSquareMinus : faSquareCheck} />
        {allVisibleSelected ? $t('manager.selectNone') : $t('manager.selectAll')}
      </button>
      <span class="opacity-70">
        {$t('manager.selectedCount', { n: selectedBookIds.size })}{#if hiddenSelectedCount}
          · {$t('manager.selectedHidden', { n: hiddenSelectedCount })}{/if}
      </span>
      {#if selectedBookIds.size && $folders$.length}
        <span class="opacity-70">{$t('manager.addToFolder')}</span>
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
            {$t('manager.removeFromFolder')}
          </button>
        {/if}
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
      {selectMode}
      on:bookClick={(ev) => onBookClick(ev.detail.id, ev.detail.shiftKey, ev.detail.toggleKey)}
      on:marqueeSelect={(ev) => onMarqueeSelect(ev.detail.ids)}
      on:removeBookClick={(ev) => handleRemove([ev.detail.id])}
      on:cardDragStart={(ev) => onCardDragStart(ev.detail.event, ev.detail.id)}
    />
  {:else if $activeFolderFilter$ === ARCHIVED_FILTER}
    <div class="mt-20 text-center text-sm opacity-60">{$t('manager.emptyArchive')}</div>
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
