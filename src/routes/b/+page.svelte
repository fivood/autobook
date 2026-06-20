<script context="module" lang="ts">
  // Survives /b unmount so navigating to /settings and back doesn't re-format the book.
  // Keyed on (bookId, viewMode, blurMode, lastBookmarkModified). Only the latest entry is kept
  // to avoid leaking object URLs from prior books.
  const formattedBookCache = new Map<
    string,
    { htmlContent: string; styleSheet: string; language?: string }
  >();
</script>

<script lang="ts">
  import {
    auditTime,
    debounceTime,
    EMPTY,
    filter,
    fromEvent,
    map,
    merge,
    NEVER,
    of,
    share,
    shareReplay,
    skip,
    startWith,
    switchMap,
    take,
    takeWhile,
    tap,
    timer
  } from 'rxjs';
  import {
    extractText,
    ttsIndexToCalculatorIndex
  } from '$lib/components/book-reader/auto-reader-shared';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { faCloudBolt, faPause, faPlay, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import BookReader from '$lib/components/book-reader/book-reader.svelte';
  import AutoScrollFab from '$lib/components/book-reader/auto-scroll-fab.svelte';
  import AutoReaderFab from '$lib/components/book-reader/auto-reader-fab.svelte';
  import type {
    AutoReader,
    AutoScroller,
    BookmarkManager,
    PageManager
  } from '$lib/components/book-reader/types';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import StyleSheetRenderer from '$lib/components/style-sheet-renderer.svelte';
  import {
    autoBookmark$,
    autoBookmarkTime$,
    autoPositionOnResize$,
    avoidPageBreak$,
    bookReaderKeybindMap$,
    database,
    enableTapEdgeToFlip$,
    enableTextJustification$,
    enableTextWrapPretty$,
    firstDimensionMargin$,
    fontFamilyGroupOne$,
    fontFamilyGroupTwo$,
    fontSize$,
    fontWeight$,
    furiganaStyle$,
    hideFurigana$,
    hideSpoilerImage$,
    multiplier$,
    autoScrollStopAtChapter$,
    pageColumns$,
    prioritizeReaderStyles$,
    secondDimensionMaxValue$,
    showFooterChapterCharacterCounter$,
    showFooterChapterPercentage$,
    textIndentation$,
    textMarginMode$,
    textMarginValue$,
    theme$,
    trackerAutostartTime$,
    verticalMode$,
    writingMode$,
    viewMode$,
    selectionToBookmarkEnabled$,
    lineHeight$,
    syncTarget$,
    autoReplication$,
    skipKeyDownListener$,
    replicationSaveBehavior$,
    cacheStorageData$,
    confirmClose$,
    verticalCustomReadingPosition$,
    horizontalCustomReadingPosition$,
    customReadingPointEnabled$,
    statisticsEnabled$,
    openTrackerOnCompletion$,
    addCharactersOnCompletion$,
    statisticsMergeMode$,
    isOnline$,
    manualBookmark$,
    customThemes$,
    overwriteBookCompletion$,
    startDayHoursForTracker$,
    readingGoalsMergeMode$,
    pauseTrackerOnCustomPointChange$,
    hideSpoilerImageMode$,
    showCharacterCounter$,
    showPercentage$,
    enableVerticalFontKerning$,
    enableFontVPAL$,
    verticalTextOrientation$,
    ttsAutoAdvanceSection$,
    ttsPositions$,
    ttsToggleRequest$,
    highlightSidebarOpen$
  } from '$lib/data/store';
  import BookCompletionConfetti from '$lib/components/book-reader/book-completion-confetti/book-completion-confetti.svelte';
  import BookReaderHeader from '$lib/components/book-reader/book-reader-header.svelte';
  import HighlightContextMenu from '$lib/components/book-reader/book-highlight/highlight-context-menu.svelte';
  import HighlightMemoDialog from '$lib/components/book-reader/book-highlight/highlight-memo-dialog.svelte';
  import HighlightSidebar from '$lib/components/book-reader/book-highlight/highlight-sidebar.svelte';
  import {
    highlights$ as hlStore$,
    initHighlightManager,
    disposeHighlightManager,
    addHighlight as addHl,
    updateHighlight as updateHl,
    removeHighlight as removeHl
  } from '$lib/components/book-reader/book-highlight/highlight-manager';
  import {
    rangeToOffsets,
    renderHighlights,
    scrollToHighlight,
    getHighlightIdFromElement
  } from '$lib/components/book-reader/book-highlight/highlight-renderer';
  import type { BooksDbHighlight, HighlightColor } from '$lib/data/database/books-db/versions/books-db';
  import {
    readerImageGalleryPictures$,
    toggleImageGalleryPictureSpoiler$,
    updateImageGalleryPictureSpoilers$
  } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
  import BookReaderImageGallery from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte';
  import {
    getDefaultStatistic,
    isTrackerMenuOpen$,
    isTrackerPaused$
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  import BookReadingTracker from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker.svelte';
  import {
    getChapterData,
    nextChapter$,
    sectionList$,
    sectionProgress$,
    tocIsOpen$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import BookToc from '$lib/components/book-reader/book-toc/book-toc.svelte';
  import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
  import NumberDialog from '$lib/components/number-dialog.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { preFilteredTitlesForStatistics$ } from '$lib/components/statistics/statistics-types';
  import {
    currentDbVersion,
    type BooksDbBookData,
    type BooksDbBookmarkData,
    type BooksDbStatistic
  } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { isTauri, pagePath } from '$lib/data/env';
  import { DB_VERSION, PAGE_CHANGE, SKIPKEYLISTENER, SYNCED } from '$lib/data/events';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import { logger } from '$lib/data/logger';
  import { MergeMode } from '$lib/data/merge-mode';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
  import {
    InternalStorageSources,
    StorageDataType,
    StorageKey
  } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { availableThemes } from '$lib/data/theme-option';
  import { ViewMode } from '$lib/data/view-mode';
  import loadBookData from '$lib/functions/book-data-loader/load-book-data';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
  import {
    AutoReplicationType,
    ReplicationSaveBehavior
  } from '$lib/functions/replication/replication-options';
  import { replicateData } from '$lib/functions/replication/replicator';
  import { readableToObservable } from '$lib/functions/rxjs/readable-to-observable';
  import { reduceToEmptyString } from '$lib/functions/rxjs/reduce-to-empty-string';
  import { takeWhenBrowser } from '$lib/functions/rxjs/take-when-browser';
  import { tapDom } from '$lib/functions/rxjs/tap-dom';
  import { multiClickHandler } from '$lib/functions/multi-click-handler';
  import {
    executeReplicate$,
    type ReplicationContext
  } from '$lib/functions/replication/replication-progress';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import {
    convertRemToPixels,
    dummyFn,
    isMobile$,
    limitToRange,
    getWeightedAverage
  } from '$lib/functions/utils';
  import { onKeydownReader } from './on-keydown-reader';
  import { onDestroy, onMount, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    clearRange,
    getParagraphToPoint,
    getRangeForUserSelection,
    getReferencePoints,
    pulseElement
  } from '$lib/functions/range-util';

  let showSpinner = true;

  $: if (browser) {
    // eslint-disable-next-line no-console
    console.log('[showSpinner] reactive value:', showSpinner);
  }
  let showHeader = false;
  let headerEnterTimer: ReturnType<typeof setTimeout> | undefined;
  let isBookmarkScreen = false;
  let showFooter = true;
  let exploredCharCount = 0;
  let bookCharCount = 0;
  let autoScroller: AutoScroller | undefined;
  let autoReader: AutoReader | undefined;
  let bookmarkManager: BookmarkManager | undefined;
  let pageManager: PageManager | undefined;
  let bookmarkData: Promise<BooksDbBookmarkData | undefined> = Promise.resolve(undefined);
  let customReadingPointTop = -2;
  let customReadingPointLeft = -2;
  let customReadingPoint = $verticalMode$
    ? $verticalCustomReadingPosition$
    : $horizontalCustomReadingPosition$;
  let customReadingPointScrollOffset = 0;
  let customReadingPointRange: Range | undefined;
  let lastSelectedRange: Range | undefined;
  let lastSelectedRangeWasEmpty = true;
  let isSelectingCustomReadingPoint = false;
  let showCustomReadingPoint = false;
  let localStorageHandler: BrowserStorageHandler;
  let dataToReplicate: StorageDataType[] = [];
  let dataToReplicateQueue: StorageDataType[] = [];
  let externalStorageHandler: BaseStorageHandler | undefined;
  let externalStorageErrors = 0;
  let isReplicating = false;
  let storedExploredCharacter = 0;
  let hasBookmarkData = false;
  let blockDataUpdates = false;
  let trackerElm: BookReadingTracker;
  let showTrackerIcon = false;
  let wasTrackerPaused = true;
  let frozenPosition = -1;
  let skipFirstFreezeChange = false;
  let bookCompleted = false;
  let confettiWidthModifier = 36;
  let confettiMaxRuns = 0;
  let showReaderImageGallery = false;
  let dismissDialogs = true;
  let hlMenuVisible = false;
  let hlMenuX = 0;
  let hlMenuY = 0;
  let hlMenuMode: 'create' | 'edit' = 'create';
  let hlEditTarget: BooksDbHighlight | undefined;
  let hlMemoDialogOpen = false;
  let hlMemoText = '';
  let hlMemoSelectedText = '';
  let hlPendingColor: HighlightColor = 'yellow';
  let hlPendingRange: Range | undefined;
  let syncedResolver: () => void;

  const syncedPromise = new Promise<void>((resolver) => {
    syncedResolver = resolver;
  });
  const queuedReaderImageGalleryPictures = new Map<string, boolean>();
  const fontFeatureSettings = [
    $enableVerticalFontKerning$ && '"vkrn"',
    $enableFontVPAL$ && '"vpal"'
  ]
    .filter((f) => !!f && $verticalMode$)
    .join(', ');
  const verticalTextOrientation = $verticalMode$ ? $verticalTextOrientation$ : '';

  const bookId$ = iffBrowser(() => readableToObservable(page)).pipe(
    map((pageObj) => Number(pageObj.url.searchParams.get('id'))),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const rawBookData$ = bookId$.pipe(
    switchMap((id) => {
      const loadPromise = (async () => {
        let bookData: BooksDbBookData | undefined;

        try {
          // eslint-disable-next-line no-console
          console.log('[loadBook] start', id);
          localStorageHandler = getStorageHandler(
          window,
          StorageKey.BROWSER,
          undefined,
          true,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );

        localStorageHandler.startContext({ id, title: '' });
        // eslint-disable-next-line no-console
        console.log('[loadBook] before getBook');
        bookData = await localStorageHandler.getBook();
        // eslint-disable-next-line no-console
        console.log('[loadBook] after getBook', bookData?.title, bookData?.storageSource, !!bookData?.elementHtml);

        if (!bookData) {
          return bookData;
        }

        const currentContext = {
          id: bookData.id,
          title: bookData.title,
          imagePath: bookData.coverImage
        };

        localStorageHandler.startContext(currentContext);

        if (bookData.storageSource) {
          // eslint-disable-next-line no-console
          console.log('[loadBook] before getStorageHandlerByName', bookData.storageSource);
          externalStorageHandler = await getStorageHandlerByName(bookData.storageSource, true);
          // eslint-disable-next-line no-console
          console.log('[loadBook] after getStorageHandlerByName');
        } else if ($autoReplication$ !== AutoReplicationType.Off) {
          // eslint-disable-next-line no-console
          console.log('[loadBook] before getStorageHandlerByName syncTarget', $syncTarget$);
          externalStorageHandler = await getStorageHandlerByName($syncTarget$);
          // eslint-disable-next-line no-console
          console.log('[loadBook] after getStorageHandlerByName syncTarget');
        }

        bookData.lastBookOpen = new Date().getTime();

        // eslint-disable-next-line no-console
        console.log('[loadBook] before updateLastRead (browser)');
        await localStorageHandler.updateLastRead(bookData);
        // eslint-disable-next-line no-console
        console.log('[loadBook] after updateLastRead (browser)');

        // eslint-disable-next-line no-console
        console.log('[loadBook] before syncDownData');
        await syncDownData(externalStorageHandler, currentContext);
        // eslint-disable-next-line no-console
        console.log('[loadBook] after syncDownData');

        if (!$statisticsEnabled$) {
          // eslint-disable-next-line no-console
          console.log('[loadBook] before setFirstBookRead');
          const wasNew = (
            await database.setFirstBookRead(currentContext.title, $startDayHoursForTracker$)
          )[1];
          // eslint-disable-next-line no-console
          console.log('[loadBook] after setFirstBookRead', wasNew);

          if (wasNew) {
            scheduleReplication(StorageDataType.STATISTICS);
          }
        }

        // eslint-disable-next-line no-console
        console.log('[loadBook] before saveExternalLastRead');
        bookData = await saveExternalLastRead(externalStorageHandler, bookData);
        // eslint-disable-next-line no-console
        console.log('[loadBook] after saveExternalLastRead', !!bookData?.elementHtml);

        if (bookData.language) {
          document.documentElement.lang = bookData.language;
        }
      } catch (error: any) {
        const message = `Error loading book: ${error.message}`;

        logger.warn(message);

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: '加载错误',
              message
            }
          }
        ]);
        return undefined;
      } finally {
        // eslint-disable-next-line no-console
        console.log('[loadBook] finally running, showSpinner -> false');
        syncedResolver();

        showSpinner = false;
        // eslint-disable-next-line no-console
        console.log('[loadBook] showSpinner after assignment:', showSpinner);
      }

      if (externalStorageHandler) {
        externalStorageHandler.updateSettings(
          window,
          true,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$,
          $cacheStorageData$,
          false,
          bookData.storageSource || $syncTarget$
        );
      }

        // eslint-disable-next-line no-console
        console.log('[loadBook] before return', !!bookData?.elementHtml);
        return bookData;
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('书籍加载超时（60秒），请检查控制台 [loadBook] 日志定位卡住的步骤')),
          60000
        );
      });

      return Promise.race([loadPromise, timeoutPromise]).catch((error: any) => {
        showSpinner = false;
        syncedResolver();

        dialogManager.dialogs$.next([
          {
            component: MessageDialog,
            props: {
              title: '加载超时',
              message: error.message
            }
          }
        ]);

        return undefined;
      });
    }),
    share()
  );

  const leaveIfBookMissing$ = rawBookData$.pipe(
    tap((data) => {
      if (!data) {
        goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
      }
    }),
    reduceToEmptyString()
  );

  const initBookmarkData$ = rawBookData$.pipe(
    tap((rawBookData) => {
      if (!rawBookData) return;
      bookmarkData = database.getBookmark(rawBookData.id);
    }),
    reduceToEmptyString()
  );

  const bookData$ = rawBookData$.pipe(
    switchMap((rawBookData) => {
      // eslint-disable-next-line no-console
      console.log('[bookData$] received rawBookData', !!rawBookData?.elementHtml);
      if (!rawBookData) return EMPTY;

      sectionList$.next(rawBookData.sections || []);
      initHighlightManager(database, rawBookData.id, rawBookData.title);

      const isPaginated = $viewMode$ === ViewMode.Paginated;
      const cacheKey = `${rawBookData.id}|${isPaginated ? 'p' : 'c'}|${$hideSpoilerImageMode$}|${rawBookData.lastBookModified || 0}`;
      const cached = formattedBookCache.get(cacheKey);
      if (cached) {
        // eslint-disable-next-line no-console
        console.log('[bookData$] returning cached');
        return of(cached);
      }

      // eslint-disable-next-line no-console
      console.log('[bookData$] before loadBookData');
      return loadBookData(
        rawBookData,
        '.book-content',
        document,
        isPaginated,
        $hideSpoilerImageMode$
      ).pipe(
        tap((data) => {
          // eslint-disable-next-line no-console
          console.log('[bookData$] after loadBookData', !!data?.htmlContent);
          // Keep only last entry; freeing the prior URLs is risky since other refs may exist.
          formattedBookCache.clear();
          formattedBookCache.set(cacheKey, data);
        })
      );
    }),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  const resize$ = iffBrowser(() =>
    visualViewport ? fromEvent(visualViewport, 'resize') : of()
  ).pipe(share());

  const containerViewportWidth$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.width || 0),
    takeWhenBrowser()
  );

  const containerViewportHeight$ = resize$.pipe(
    startWith(0),
    map(() => visualViewport?.height || 0),
    takeWhenBrowser()
  );

  const themeOption$ = theme$.pipe(
    map(
      (theme) =>
        $customThemes$[theme] || availableThemes.get(theme) || availableThemes.get('sage-green-theme') || availableThemes.get('light-theme')
    ),
    filter((o): o is NonNullable<typeof o> => !!o),
    takeWhenBrowser()
  );

  const backgroundColor$ = themeOption$.pipe(map((o) => o.backgroundColor));

  const collectReaderImageGallerySpoilerToggles$ = toggleImageGalleryPictureSpoiler$.pipe(
    tap((readerImageGalleryPicture) => {
      queuedReaderImageGalleryPictures.set(
        readerImageGalleryPicture.url,
        readerImageGalleryPicture.unspoilered
      );

      updateImageGalleryPictureSpoilers$.next();
    }),
    reduceToEmptyString()
  );

  const handleUpdateImageGalleryPictureSpoilers$ = updateImageGalleryPictureSpoilers$.pipe(
    debounceTime(250),
    tap(() => {
      $readerImageGalleryPictures$ = $readerImageGalleryPictures$.map((galleryPicture) => {
        const picture = galleryPicture;

        if (queuedReaderImageGalleryPictures.has(picture.url)) {
          picture.unspoilered = queuedReaderImageGalleryPictures.get(picture.url)!;
        }

        return picture;
      });

      queuedReaderImageGalleryPictures.clear();
    }),
    reduceToEmptyString()
  );

  const backgroundStyleName = 'background-color';
  const setBackgroundColor$ = backgroundColor$.pipe(
    tapDom(
      () => document.body,
      (backgroundColor, body) => body.style.setProperty(backgroundStyleName, backgroundColor),
      (body) => body.style.removeProperty(backgroundStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const writingModeStyleName = 'writing-mode';
  const setWritingMode$ = writingMode$.pipe(
    tapDom(
      () => document.documentElement,
      (writingMode, documentElement) =>
        documentElement.style.setProperty(writingModeStyleName, writingMode),
      (documentElement) => documentElement.style.removeProperty(writingModeStyleName)
    ),
    reduceToEmptyString(),
    takeWhenBrowser()
  );

  const sectionData$ = iffBrowser(() => sectionProgress$).pipe(
    map((sectionProgress) => [...sectionProgress.values()])
  );

  const textSelector$ = iffBrowser(() => fromEvent(document, 'selectionchange')).pipe(
    debounceTime(200),
    tap(() => {
      const currentSelected = window.getSelection()?.toString() || '';

      if (!currentSelected && lastSelectedRangeWasEmpty) {
        lastSelectedRange = undefined;
      } else if (currentSelected) {
        lastSelectedRange = window.getSelection()?.getRangeAt(0);
        lastSelectedRangeWasEmpty = false;
      } else {
        lastSelectedRangeWasEmpty = true;
      }
    }),
    reduceToEmptyString()
  );

  const replicator$ = executeReplicate$.pipe(
    auditTime(60000),
    switchMap(() => executeReplication()),
    reduceToEmptyString()
  );

  const autoStartTracker$ = iffBrowser(() =>
    $statisticsEnabled$ && $trackerAutostartTime$ > 0 ? fromEvent(document, PAGE_CHANGE) : NEVER
  ).pipe(
    debounceTime($trackerAutostartTime$ * 1000),
    take(1),
    tap(() => {
      wasTrackerPaused = false;
      isTrackerPaused$.next(wasTrackerPaused);
    }),
    reduceToEmptyString()
  );

  let hlRafId = 0;
  let pendingScrollHlId = browser
    ? Number(new URL(window.location.href).searchParams.get('hl')) || 0
    : 0;
  let pendingSectionAdjusted = false;

  function scheduleHighlightRender(highlights: BooksDbHighlight[]) {
    cancelAnimationFrame(hlRafId);
    hlRafId = requestAnimationFrame(function retry() {
      const el = getBookContentEl();
      if (el) {
        renderHighlights(el, highlights);
        if (pendingScrollHlId) {
          const target = highlights.find((h) => h.id === pendingScrollHlId);
          if (target) {
            const mark = el.querySelector(`mark[data-hl-id="${pendingScrollHlId}"]`);
            if (mark) {
              scrollToHighlight(el, target);
              pendingScrollHlId = 0;
              pendingSectionAdjusted = false;
              const url = new URL(window.location.href);
              url.searchParams.delete('hl');
              window.history.replaceState({}, '', url.toString());
            } else if (
              !pendingSectionAdjusted &&
              $viewMode$ === ViewMode.Paginated &&
              $sectionData$ &&
              $sectionData$.length
            ) {
              const secStarts = $sectionData$.map((s) => s.startCharacter ?? 0);
              let idx = 0;
              for (let i = secStarts.length - 1; i >= 0; i--) {
                if (target.startOffset >= secStarts[i]) {
                  idx = i;
                  break;
                }
              }
              if (idx !== currentSectionIndex) {
                currentSectionIndex = idx;
              }
              pendingSectionAdjusted = true;
            }
          }
        }
      } else {
        hlRafId = requestAnimationFrame(retry);
      }
    });
  }

  $: scheduleHighlightRender($hlStore$);

  $: if ($highlightSidebarOpen$) {
    autoScroller?.off();
    autoReader?.off();
  }

  $: if ($tocIsOpen$) {
    autoScroller?.off();
    autoReader?.off();
  }

  $: if (browser && bookCharCount) {
    document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { exploredCharCount } }));
  }

  $: if (browser) {
    document.dispatchEvent(new CustomEvent(PAGE_CHANGE, { detail: { bookCharCount } }));
  }

  $: if (showCustomReadingPoint) {
    pauseTracker();

    pulseElement(customReadingPointRange?.endContainer?.parentElement, 'add', 1);

    fromEvent(document, 'click')
      .pipe(skip(1), take(1))
      .subscribe(() => {
        showCustomReadingPoint = false;
        pulseElement(customReadingPointRange?.endContainer?.parentElement, 'remove', 1);
        restartTrackerAfterCharacterChangeOrTime(1);
      });
  }

  $: if (frozenPosition !== -1 && exploredCharCount >= frozenPosition) {
    if (skipFirstFreezeChange) {
      skipFirstFreezeChange = false;
    } else {
      frozenPosition = -1;
    }
  }

  $: isPaginated = $viewMode$ === ViewMode.Paginated;

  // --- TTS position memory ---
  let currentSectionIndex = 0;
  let sectionStartCharCount = 0;
  let lastTtsSaveTime = 0;
  let ttsExtractedText = '';
  let ttsExtractedTextSection = -1;

  $: ttsSeekCharCount = Math.max(0, exploredCharCount - sectionStartCharCount);

  $: ttsResumePosition = (() => {
    const id = getBookIdSync();
    if (!id) return undefined;
    const saved = $ttsPositions$[String(id)];
    if (!saved) return undefined;
    if (saved.section !== currentSectionIndex) return undefined;
    // Only resume when the visible position is where the user left off —
    // an intentional jump elsewhere should start TTS from the new spot.
    if (Math.abs(saved.explored - exploredCharCount) > 30) return undefined;
    return { para: saved.para, offset: saved.offset };
  })();

  function persistTtsPosition() {
    const id = getBookIdSync();
    if (!id || !autoReader) return;
    const { para, offset } = autoReader.getPosition();
    $ttsPositions$ = {
      ...$ttsPositions$,
      [String(id)]: {
        section: currentSectionIndex,
        para,
        offset,
        explored: exploredCharCount
      }
    };
  }

  function clearTtsPosition() {
    const id = getBookIdSync();
    if (!id) return;
    const next = { ...$ttsPositions$ };
    delete next[String(id)];
    $ttsPositions$ = next;
  }

  let ttsWiredReader: AutoReader | undefined;
  /** When >=0, TTS hit a section end and we're waiting for currentSectionIndex
   * to reach this value before re-preparing + resuming reading. */
  let ttsAwaitingSection = -1;

  $: if (autoReader && autoReader !== ttsWiredReader && isPaginated && browser) {
    ttsWiredReader = autoReader;
    autoReader.onBoundary = (charIndex) => {
      // Auto-page-flip: whatever the TTS engine is about to speak should be
      // on-screen. charIndex is a section-local offset into extractText()'s
      // raw string (counts whitespace, punctuation, …). The paginated
      // calculator uses getCharacterCount() which strips those — translate
      // before handing it over so we don't drift off the section end.
      if (typeof charIndex === 'number') {
        const el = document.querySelector('.book-content') as HTMLElement | null;
        let calcLocal = charIndex;
        if (el) {
          if (ttsExtractedTextSection !== currentSectionIndex) {
            ttsExtractedText = extractText(el);
            ttsExtractedTextSection = currentSectionIndex;
          }
          calcLocal = ttsIndexToCalculatorIndex(ttsExtractedText, charIndex);
        }
        pageManager?.ensureCharVisible?.(calcLocal + sectionStartCharCount);
      }
      const now = Date.now();
      if (now - lastTtsSaveTime < 2000) return;
      lastTtsSaveTime = now;
      persistTtsPosition();
    };
    autoReader.onEnd = () => {
      if (!$ttsAutoAdvanceSection$) {
        clearTtsPosition();
        return;
      }
      const sectionAtEnd = currentSectionIndex;
      // Defer so the audio-end → off → onEnd chain settles before we touch
      // Svelte stores.
      setTimeout(() => {
        if (!pageManager || typeof pageManager.advanceToNextSection !== 'function') {
          clearTtsPosition();
          return;
        }
        // Must call as a method so `this` binds — otherwise the inner
        // `this.nextSection(...)` throws.
        const advanced = pageManager.advanceToNextSection();
        if (advanced) {
          ttsAwaitingSection = sectionAtEnd + 1;
        } else {
          clearTtsPosition();
        }
      }, 0);
    };
    autoReader.wasReaderEnabled$.subscribe((enabled) => {
      // Pausing saves the precise spot (throttled boundary saves lag ~2s).
      if (!enabled && ttsWiredReader === autoReader) persistTtsPosition();
    });
  }

  // After the new section finishes rendering (currentSectionIndex catches up),
  // re-extract paragraphs and resume from paragraph 0.
  $: if (
    ttsAwaitingSection >= 0 &&
    currentSectionIndex >= ttsAwaitingSection &&
    autoReader
  ) {
    ttsAwaitingSection = -1;
    // Defer so DOM/innerHTML updates from the new section land before
    // extractText() runs.
    setTimeout(() => {
      autoReader?.prepare();
      autoReader?.setPosition(0, 0);
      autoReader?.on();
    }, 300);
  }

  $: firstDimensionMargin =
    browser && $enableTapEdgeToFlip$ && isPaginated && $verticalMode$
      ? limitToRange(convertRemToPixels(window, 0.5), window.innerWidth, $firstDimensionMargin$)
      : ($firstDimensionMargin$ ?? 0);

  $: tapButtonHeight = `calc(100% - ${showHeader ? 5 : 4}rem)`;

  $: tapButtonTop = `${showHeader ? 3 : 2}rem`;

  $: footerChapterProgress = getCurrentChapterProgress($sectionData$);

  let lastChapterIndexForAutoStop = -1;
  $: if ($sectionData$?.length && autoScroller) {
    const [, chapterIndex] = getChapterData($sectionData$);
    if (
      lastChapterIndexForAutoStop !== -1 &&
      chapterIndex !== lastChapterIndexForAutoStop &&
      $autoScrollStopAtChapter$ &&
      autoScroller.wasAutoScrollerEnabled$.getValue()
    ) {
      autoScroller.off();
    }
    lastChapterIndexForAutoStop = chapterIndex;
  }

  $: upSyncEnabled =
    externalStorageHandler &&
    ($autoReplication$ === AutoReplicationType.Up || $autoReplication$ === AutoReplicationType.All);

  $: bookmarkData.then((data) => {
    hasBookmarkData = !!data;
    storedExploredCharacter = data?.exploredCharCount || 0;
  });

  /** Experimental Code - May be removed any time without warning */

  $: if (browser) {
    document.dispatchEvent(new CustomEvent(SKIPKEYLISTENER, { detail: $skipKeyDownListener$ }));
  }

  function handleGlobalContextMenu(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    if (!target.closest('.book-content')) return;
    handleBookContentContextMenu(ev);
  }

  function handleGlobalClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    if (!target.closest('.book-content')) return;
    handleBookContentClick(ev);
  }

  onMount(() => {
    document.addEventListener('ttu-action', handleAction, false);
    document.addEventListener('contextmenu', handleGlobalContextMenu);
    document.addEventListener('click', handleGlobalClick);
  });

  // Tray menu / global shortcut request TTS toggle. Works in both view modes
  // (continuous + paginated) since AutoReaderContinuous is wired in both.
  let lastTtsToggleAt = 0;
  $: if (browser && $ttsToggleRequest$ > lastTtsToggleAt && autoReader) {
    lastTtsToggleAt = $ttsToggleRequest$;
    if (!autoReader.wasReaderEnabled$.getValue()) {
      autoReader.prepare();
      if (ttsResumePosition) {
        autoReader.setPosition(ttsResumePosition.para, ttsResumePosition.offset);
      } else {
        autoReader.seekToExplored(ttsSeekCharCount);
      }
    }
    autoReader.toggle();
  }

  function handleAction({ detail }: any) {
    if (!detail.type) {
      return;
    }

    if (detail.type === 'dbVersion') {
      document.dispatchEvent(new CustomEvent(DB_VERSION, { detail: currentDbVersion }));
    } else if (detail.type === 'waitForSync') {
      syncedPromise.finally(() => document.dispatchEvent(new CustomEvent(SYNCED)));
    } else if (detail.type === 'skipKeyDownListener') {
      skipKeyDownListener$.next(detail.params.value);
    } else if (
      detail.type === 'sync' &&
      (detail.syncType === StorageDataType.AUDIOBOOK ||
        detail.syncType === StorageDataType.SUBTITLE)
    ) {
      scheduleReplication(detail.syncType);
    }
  }
  /** Experimental Code - May be removed any time without warning */

  onDestroy(() => {
    if (browser) {
      document.removeEventListener('ttu-action', handleAction, false);
      document.removeEventListener('contextmenu', handleGlobalContextMenu);
      document.removeEventListener('click', handleGlobalClick);
      document.documentElement.lang = 'ja';
    }

    readerImageGalleryPictures$.next([]);
    cancelAnimationFrame(hlRafId);
    disposeHighlightManager();

    if (dismissDialogs) {
      dialogManager.dialogs$.next([]);
    }
  });

  function handleUnload(event: BeforeUnloadEvent) {
    if (
      $confirmClose$ &&
      (isReplicating ||
        storedExploredCharacter !== exploredCharCount ||
        (upSyncEnabled && dataToReplicate.length) ||
        (upSyncEnabled && dataToReplicateQueue.length))
    ) {
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      return (event.returnValue = '确定要退出吗？');
    }

    return event;
  }

  function trackerSingleClickHandler() {
    if (!statisticsEnabled$) {
      return;
    }

    wasTrackerPaused = $isTrackerPaused$;
    isTrackerPaused$.next(true);
    isTrackerMenuOpen$.next(true);
  }

  function trackerDblClickHandler() {
    if (!statisticsEnabled$) {
      return;
    }

    dialogManager.dialogs$.next([]);
    wasTrackerPaused = !$isTrackerPaused$;
    isTrackerPaused$.next(wasTrackerPaused);
  }

  async function handleJump() {
    const dataId = getBookIdSync();

    if (!bookmarkManager || !dataId) {
      return;
    }

    pauseTracker();
    skipKeyDownListener$.next(true);

    const total = bookCharCount || 1;
    const currentPct = total > 1 ? Math.round((exploredCharCount / total) * 100) : 0;

    const percent = await new Promise<number | undefined>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: NumberDialog,
          props: {
            dialogHeader: `跳转到进度（当前 ${currentPct}%）`,
            minValue: 0,
            maxValue: 100,
            resolver
          }
        }
      ]);
    });

    skipKeyDownListener$.next(false);

    if (typeof percent !== 'number') {
      restartTrackerAfterCharacterChangeOrTime(1);
      return;
    }

    restartTrackerAfterCharacterChangeOrTime(1000);

    const target = Math.min(total, Math.max(1, Math.round((percent / 100) * total)));

    bookmarkManager.scrollToBookmark(
      {
        dataId: dataId,
        exploredCharCount: target,
        lastBookmarkModified: new Date().getTime(),
        progress: 0
      },
      customReadingPointScrollOffset
    );
  }

  async function completeBook() {
    if (!$rawBookData$) {
      return;
    }

    const wasAutoscrollerEnabled = autoScroller?.wasAutoScrollerEnabled$.getValue();
    const wasTrackerPausedBefore = $statisticsEnabled$ ? $isTrackerPaused$ : true;

    showHeader = false;
    autoScroller?.off();
    autoReader?.off();

    if ($statisticsEnabled$) {
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);
    }

    const diffToComplete =
      $statisticsEnabled$ && $addCharactersOnCompletion$
        ? Math.max(0, bookCharCount - exploredCharCount)
        : 0;
    const wasCanceled = await new Promise((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: ConfirmDialog,
          props: {
            dialogHeader: '完成本书',
            dialogMessage: `您想要完成本书吗${
              diffToComplete ? ` and capture ${diffToComplete} characters read` : ''
            }?`,
            resolver
          }
        }
      ]);
    });

    if (wasCanceled) {
      if ($statisticsEnabled$ && !wasTrackerPausedBefore) {
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      }

      if (wasAutoscrollerEnabled) {
        autoScroller?.toggle();
      }

      return;
    }

    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);

    try {
      if (diffToComplete) {
        const [hadError] = await trackerElm.processStatistics(diffToComplete);

        if (hadError) {
          throw new Error('字数更新失败');
        }
      }

      const finishedStatistic = await database.getStatisticForCompletedBook($rawBookData$.title);
      const todayKey = getDateKey($startDayHoursForTracker$);
      const statisticsUntilToday = await database.getStatisticsUntilDate(
        $rawBookData$.title,
        todayKey
      );
      const todayStatistic =
        statisticsUntilToday.find((statistic) => statistic.dateKey === todayKey) ||
        getDefaultStatistic($rawBookData$.title, todayKey);
      const statisticsToStore: BooksDbStatistic[] = [];
      const lastStatisticModified = Date.now();

      todayStatistic.lastStatisticModified = lastStatisticModified;
      todayStatistic.completedBook = 1;
      todayStatistic.completedData = {
        ...{ dateKey: todayKey },
        ...BaseStorageHandler.getStatisticsMetadata(
          BaseStorageHandler.getStatisticsFileName(
            statisticsUntilToday,
            todayStatistic.lastStatisticModified
          )
        )
      };

      let updateFinishedStatistic = false;

      if (!finishedStatistic) {
        statisticsToStore.push(todayStatistic);
      } else if (
        $overwriteBookCompletion$ &&
        finishedStatistic.dateKey !== todayStatistic.dateKey
      ) {
        delete finishedStatistic.completedBook;
        delete finishedStatistic.completedData;
        finishedStatistic.lastStatisticModified = lastStatisticModified;
        statisticsToStore.push(todayStatistic, finishedStatistic);
        updateFinishedStatistic = true;
      } else if ($overwriteBookCompletion$) {
        statisticsToStore.push(todayStatistic);
      }

      if (statisticsToStore.length) {
        await database.storeStatistics(
          $rawBookData$.title,
          statisticsToStore,
          ReplicationSaveBehavior.Overwrite,
          MergeMode.LOCAL,
          lastStatisticModified
        );

        trackerElm?.updateCompletedBook(
          todayStatistic,
          updateFinishedStatistic ? finishedStatistic : undefined
        );

        scheduleReplication(StorageDataType.STATISTICS);
      }

      if (bookmarkManager) {
        const data = {
          ...bookmarkManager.formatBookmarkData($rawBookData$.id, customReadingPointScrollOffset),
          exploredCharCount: Math.max(0, bookCharCount - 1),
          progress: 1
        };

        await database.putBookmark(data);

        bookmarkData = Promise.resolve(data);

        scheduleReplication(StorageDataType.PROGRESS);
      }

      if ($statisticsEnabled$ && $openTrackerOnCompletion$) {
        confettiWidthModifier = 36;
        confettiMaxRuns = 0;
        bookCompleted = window.matchMedia('(min-width: 900px)').matches;
        isTrackerMenuOpen$.next(true);
      } else {
        dialogManager.dialogs$.next([]);
        confettiWidthModifier = 0;
        confettiMaxRuns = 3;
        bookCompleted = true;

        merge(fromEvent(document, 'pointerup'), timer(10000))
          .pipe(take(1))
          .subscribe(() => {
            bookCompleted = false;
          });
      }
    } catch ({ message }: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '错误',
            message: `Error completing Book: ${message}`
          }
        }
      ]);
    }
  }

  function getCurrentChapterProgress(sectionData: SectionWithProgress[]) {
    if (
      (!$showFooterChapterCharacterCounter$ && !$showFooterChapterPercentage$) ||
      !sectionData?.length
    ) {
      return '';
    }

    let chapterProgress = '';
    let chapterCharacters = '';

    const [mainChapters, chapterIndex, referenceId] = getChapterData($sectionData$);

    if ($showFooterChapterPercentage$) {
      const relevantSections = sectionData.filter(
        (section) => section.reference === referenceId || section.parentChapter === referenceId
      );

      chapterProgress = `${getWeightedAverage(
        relevantSections.map((section) => section.progress),
        relevantSections.map((section) => section.charactersWeight)
      ).toFixed(2)}%`;
    }

    if ($showFooterChapterCharacterCounter$) {
      const currentChapter = mainChapters[chapterIndex];

      if (currentChapter) {
        const endCharacter = currentChapter.characters as number;

        chapterCharacters = `${Math.min(
          Math.max(exploredCharCount - (currentChapter.startCharacter as number), 0),
          endCharacter
        )} / ${endCharacter}`;
      }
    }

    return [chapterCharacters, chapterProgress, 'C'].filter(Boolean).join(' ');
  }

  function copyCurrentProgress(currentProgress: string) {
    try {
      navigator.clipboard.writeText(currentProgress);
    } catch (error: any) {
      logger.error(`Error writing Progress to Clipboard: ${error.message}`);
    }
  }

  function freezeTrackerPosition() {
    if (!$statisticsEnabled$) {
      return;
    }

    if (frozenPosition > -1) {
      frozenPosition = -1;
    } else {
      skipFirstFreezeChange = true;
      frozenPosition = exploredCharCount;
    }
  }

  async function getStorageHandlerByName(storageSourceName: string, throwIfNotFound = false) {
    if (!storageSourceName) {
      if (throwIfNotFound) {
        throw new Error(`No storage source found`);
      }

      return undefined;
    }

    if (
      storageSourceName === InternalStorageSources.INTERNAL_TAURI_FS ||
      (storageSourceName === InternalStorageSources.INTERNAL_DEFAULT && isTauri())
    ) {
      return getStorageHandler(
        window,
        StorageKey.TAURI_FS,
        storageSourceName,
        true,
        $cacheStorageData$,
        $replicationSaveBehavior$,
        $statisticsMergeMode$,
        $readingGoalsMergeMode$
      );
    }
    if (storageSourceName) {
      const db = await database.db;
      const storageSource = await db.get('storageSource', storageSourceName);

      if (storageSource) {
        return getStorageHandler(
          window,
          storageSource.type,
          storageSourceName,
          true,
          $cacheStorageData$,
          $replicationSaveBehavior$,
          $statisticsMergeMode$,
          $readingGoalsMergeMode$
        );
      }
      if (throwIfNotFound) {
        throw new Error(`No storage source with name ${storageSourceName} found`);
      }
    }

    const message = `未找到名为 ${storageSourceName} 的存储来源 - 跳过自动导入/导出`;

    logger.warn(message);

    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: '配置错误',
          message
        }
      }
    ]);

    return undefined;
  }

  async function saveExternalLastRead(
    storageHandler: BaseStorageHandler | undefined,
    localBookData: BooksDbBookData
  ) {
    if (!storageHandler) {
      return localBookData;
    }

    // eslint-disable-next-line prefer-const
    let { id, ...bookData } = localBookData;

    if (localBookData.storageSource) {
      const externalBookData = await storageHandler.getBook();

      if (externalBookData instanceof File) {
        throw new Error(
          `外部书籍数据格式错误（返回了文件而非解析后的数据）：${localBookData.title}`
        );
      }

      if (externalBookData) {
        bookData = {
          ...externalBookData,
          ...{
            id: localBookData.id,
            lastBookOpen: localBookData.lastBookOpen,
            storageSource: localBookData.storageSource
          }
        };
      } else if (!localBookData.elementHtml) {
        throw new Error(
          `未找到外部书籍数据：${localBookData.storageSource} 中不存在《${localBookData.title}》的书籍文件`
        );
      } else {
        logger.warn(
          `外部存储 ${localBookData.storageSource} 中未找到《${localBookData.title}》的数据，使用本地缓存`
        );
      }
    } else if (!localBookData.elementHtml) {
      throw new Error('书籍没有存储数据');
    }

    const dataToReturn = { id, ...bookData };

    await storageHandler.updateLastRead(dataToReturn).catch((error: any) => {
      const message = `Failed to update last read on external storage: ${error.message}`;

      logger.warn(message);

      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '更新错误',
            message
          }
        }
      ]);
    });

    return dataToReturn;
  }

  async function syncDownData(
    storageHandler: BaseStorageHandler | undefined,
    context: ReplicationContext
  ) {
    if (localStorageHandler && storageHandler) {
      storageHandler.startContext(context);
    }

    if (
      localStorageHandler &&
      storageHandler &&
      ($autoReplication$ === AutoReplicationType.Down ||
        $autoReplication$ === AutoReplicationType.All)
    ) {
      const error = await replicateData(
        storageHandler,
        localStorageHandler,
        false,
        [context],
        [
          StorageDataType.PROGRESS,
          StorageDataType.STATISTICS,
          StorageDataType.READING_GOALS,
          StorageDataType.AUDIOBOOK,
          StorageDataType.SUBTITLE,
          StorageDataType.HIGHLIGHT
        ]
      );

      if (error) {
        throw new Error(error);
      }
    }
  }

  function onKeydown(ev: KeyboardEvent) {
    if (
      $skipKeyDownListener$ ||
      ev.altKey ||
      ev.ctrlKey ||
      ev.shiftKey ||
      ev.metaKey ||
      ev.repeat
    ) {
      return;
    }

    const result = onKeydownReader(
      ev,
      bookReaderKeybindMap$.getValue(),
      bookmarkPage,
      scrollToBookmark,
      (x) => multiplier$.next(multiplier$.getValue() + x),
      autoScroller,
      autoReader,
      pageManager,
      $verticalMode$,
      changeChapter,
      handleSetCustomReadingPoint,
      trackerDblClickHandler,
      freezeTrackerPosition,
      isPaginated
    );

    if (!result) return;

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    ev.preventDefault();
  }

  function getBookIdSync() {
    let bookId: number | undefined;
    bookId$.subscribe((x) => (bookId = x)).unsubscribe();
    return bookId;
  }

  function getBookContentEl(): HTMLElement | null {
    return document.querySelector('.book-content');
  }

  function handleBookContentContextMenu(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const existingHlId = getHighlightIdFromElement(target);

    if (existingHlId !== undefined) {
      ev.preventDefault();
      const hl = $hlStore$.find((h) => h.id === existingHlId);
      if (!hl) return;
      hlEditTarget = hl;
      hlMenuMode = 'edit';
      hlMenuX = ev.clientX;
      hlMenuY = ev.clientY;
      hlMenuVisible = true;
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    ev.preventDefault();
    hlPendingRange = sel.getRangeAt(0);
    hlMenuMode = 'create';
    hlMenuX = ev.clientX;
    hlMenuY = ev.clientY;
    hlMenuVisible = true;
  }

  function handleBookContentClick(ev: MouseEvent) {
    const target = ev.target as HTMLElement;
    const existingHlId = getHighlightIdFromElement(target);
    if (existingHlId === undefined) return;

    const hl = $hlStore$.find((h) => h.id === existingHlId);
    if (!hl) return;
    hlEditTarget = hl;
    hlMenuMode = 'edit';
    hlMenuX = ev.clientX;
    hlMenuY = ev.clientY;
    hlMenuVisible = true;
  }

  async function handleHlColor(color: HighlightColor) {
    const container = getBookContentEl();
    if (!container) return;

    if (hlMenuMode === 'create' && hlPendingRange) {
      const offsets = rangeToOffsets(container, hlPendingRange);
      if (!offsets) return;
      const text = hlPendingRange.toString();
      await addHl(offsets.start, offsets.end, text, color);
      window.getSelection()?.removeAllRanges();
      hlPendingRange = undefined;
    } else if (hlMenuMode === 'edit' && hlEditTarget) {
      await updateHl(hlEditTarget.id, { color });
    }

    hlMenuVisible = false;
    hlEditTarget = undefined;
  }

  function handleHlMemoRequest() {
    if (hlMenuMode === 'create' && hlPendingRange) {
      hlMemoSelectedText = hlPendingRange.toString();
      hlMemoText = '';
      hlPendingColor = 'yellow';
      hlMemoDialogOpen = true;
      skipKeyDownListener$.next(true);
    }
    hlMenuVisible = false;
  }

  function handleHlEditMemoRequest() {
    if (hlEditTarget) {
      hlMemoSelectedText = hlEditTarget.text;
      hlMemoText = hlEditTarget.memo;
      skipKeyDownListener$.next(true);
      hlMemoDialogOpen = true;
    }
    hlMenuVisible = false;
  }

  async function handleHlMemoSave(memo: string) {
    const container = getBookContentEl();
    if (!container) return;

    if (hlEditTarget) {
      await updateHl(hlEditTarget.id, { memo });
      hlEditTarget = undefined;
    } else if (hlPendingRange) {
      const offsets = rangeToOffsets(container, hlPendingRange);
      if (offsets) {
        const text = hlPendingRange.toString();
        await addHl(offsets.start, offsets.end, text, hlPendingColor, memo);
      }
      window.getSelection()?.removeAllRanges();
      hlPendingRange = undefined;
    }

    hlMemoDialogOpen = false;
    skipKeyDownListener$.next(false);
  }

  async function handleHlDelete() {
    if (!hlEditTarget) return;
    await removeHl(hlEditTarget.id);
    hlEditTarget = undefined;
    hlMenuVisible = false;
  }

  function handleHlNavigate(hl: BooksDbHighlight) {
    const container = getBookContentEl();
    if (!container) return;
    scrollToHighlight(container, hl);
    highlightSidebarOpen$.next(false);
  }

  async function handleHlSidebarDelete(hl: BooksDbHighlight) {
    await removeHl(hl.id);
  }

  function handleHlSidebarEditMemo(hl: BooksDbHighlight) {
    hlEditTarget = hl;
    hlMemoSelectedText = hl.text;
    hlMemoText = hl.memo;
    skipKeyDownListener$.next(true);
    hlMemoDialogOpen = true;
  }

  async function bookmarkPage() {
    const bookId = getBookIdSync();
    if (!bookId || !bookmarkManager) return;

    let data: BooksDbBookmarkData;

    showHeader = false;

    if (isPaginated) {
      const userSelectedRange = $selectionToBookmarkEnabled$
        ? getRangeForUserSelection(window, lastSelectedRange)
        : undefined;
      const bookmarkRange = userSelectedRange || customReadingPointRange;

      pulseElement(bookmarkRange?.endContainer?.parentElement, 'add', 0.5, 500);

      data = bookmarkManager.formatBookmarkDataByRange(bookId, bookmarkRange);

      if (userSelectedRange) {
        clearRange(window);
      }
    } else {
      data = bookmarkManager.formatBookmarkData(bookId, customReadingPointScrollOffset);
    }

    await database.putBookmark(data);

    bookmarkData = Promise.resolve(data);

    scheduleReplication(StorageDataType.PROGRESS);
  }

  async function scrollToBookmark() {
    const data = await bookmarkData;
    if (!data || !bookmarkManager) return;

    if (data.exploredCharCount !== exploredCharCount) {
      pauseTracker(true);
    }

    bookmarkManager.scrollToBookmark(data, customReadingPointScrollOffset);
  }

  function onFullscreenClick() {
    showHeader = false;

    if (!fullscreenManager.fullscreenElement) {
      fullscreenManager.requestFullscreen(document.documentElement);
      return;
    }
    fullscreenManager.exitFullscreen();
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

  function changeChapter(offset: number) {
    if (!$sectionData$?.length) {
      return;
    }

    const [mainChapters, currentChapterIndex] = getChapterData($sectionData$);

    if (
      (!currentChapterIndex && offset === -1) ||
      (offset === 1 && currentChapterIndex === mainChapters.length - 1)
    ) {
      return;
    }

    const nextChapter = mainChapters[currentChapterIndex + offset];

    if (!nextChapter) {
      return;
    }

    if (nextChapter.startCharacter !== exploredCharCount) {
      pauseTracker(true);
    }

    nextChapter$.next(nextChapter.reference);
  }

  async function executeReplication(isSilent = true) {
    if (isReplicating || !dataToReplicate.length || !$rawBookData$ || !externalStorageHandler) {
      return;
    }

    isReplicating = true;

    if (!isSilent) {
      skipKeyDownListener$.next(true);
      logger.clearHistory();
      openActionBackdrop();
    }

    const currentHandlerStorageSource = $rawBookData$.storageSource || $syncTarget$;

    externalStorageHandler.updateSettings(
      window,
      false,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      !isSilent,
      currentHandlerStorageSource
    );

    const error = await replicateData(
      localStorageHandler,
      externalStorageHandler,
      !isSilent && $storageSource$ === externalStorageHandler.storageType,
      [
        {
          id: $rawBookData$.id,
          title: $rawBookData$.title,
          imagePath: $rawBookData$.coverImage
        }
      ],
      dataToReplicate
    ).catch((err: any) => err.message);

    externalStorageHandler.updateSettings(
      window,
      true,
      $replicationSaveBehavior$,
      $statisticsMergeMode$,
      $readingGoalsMergeMode$,
      $cacheStorageData$,
      false,
      currentHandlerStorageSource
    );

    isReplicating = false;

    if (error) {
      if (!isSilent) {
        const showReport = logger.errorCount > 1;

        logger.warn(error);

        dialogManager.dialogs$.next([
          {
            component: showReport ? LogReportDialog : MessageDialog,
            props: {
              title: '处理数据错误',
              message: showReport
                ? `部分或全部数据无法存储到外部存储`
                : error
            }
          }
        ]);
      }

      externalStorageErrors += 1;
    } else {
      externalStorageErrors = 0;

      if (!isSilent) {
        dialogManager.dialogs$.next([]);
      }

      if (dataToReplicateQueue.length) {
        const isAudioBookOnly =
          dataToReplicate.length === 1 && dataToReplicate[0] === StorageDataType.AUDIOBOOK;
        dataToReplicate = JSON.parse(JSON.stringify(dataToReplicateQueue));
        dataToReplicateQueue = [];

        if (isSilent || isAudioBookOnly) {
          executeReplicate$.next();
        } else if (!isAudioBookOnly) {
          await executeReplication(false);
        } else {
          dataToReplicate = [];
        }
      } else {
        dataToReplicate = [];
      }
    }

    if (!isSilent) {
      skipKeyDownListener$.next(false);
    }
  }

  function openActionBackdrop() {
    dialogManager.dialogs$.next([
      {
        component: '<div/>',
        disableCloseOnClick: true
      }
    ]);
  }

  async function leaveReader(routeId: string, deleteLastItem = true) {
    let message;

    try {
      blockDataUpdates = true;

      await tick();

      autoScroller?.off();
    autoReader?.off();
      wasTrackerPaused = true;
      isTrackerPaused$.next(true);

      if ($confirmClose$ && storedExploredCharacter !== exploredCharCount) {
        const wasCanceled = await new Promise((resolver) => {
          dialogManager.dialogs$.next([
            {
              component: ConfirmDialog,
              props: {
                dialogHeader: '确认退出',
                dialogMessage: '当前位置未添加书签。继续离开吗？',
                resolver
              },

              disableCloseOnClick: true
            }
          ]);
        });

        if (wasCanceled) {
          blockDataUpdates = false;
          return;
        }

        await tick();
      }

      openActionBackdrop();

      if (deleteLastItem) {
        await database.deleteLastItem();
      }

      if (!$manualBookmark$) {
        await bookmarkPage();
      }

      if ($statisticsEnabled$ && trackerElm) {
        const [hadError, updated] = await trackerElm.flushUpdates(true);

        if (hadError) {
          throw new Error('更新统计出错');
        }

        if (updated) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }

      dialogManager.dialogs$.next([]);

      if (upSyncEnabled) {
        await executeReplication(false);
      }
    } catch (error: any) {
      message = error.message;
    }

    if (message) {
      logger.error(message);

      dismissDialogs = false;
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '错误',
            message
          },
          disableCloseOnClick: true
        }
      ]);
    }

    goto(`${pagePath}${routeId}`);
  }

  function handleSetCustomReadingPoint() {
    if (!$customReadingPointEnabled$ && !isPaginated) {
      return;
    }

    const contentEl = document.querySelector('.book-content');

    if (!contentEl) {
      return;
    }

    autoScroller?.off();
    autoReader?.off();

    if ($pauseTrackerOnCustomPointChange$) {
      pauseTracker();
    }

    if (isPaginated) {
      customReadingPointTop = window.innerHeight / 2 - 2;
      customReadingPointLeft = window.innerWidth / 2 - 2;
    }

    showHeader = false;
    isSelectingCustomReadingPoint = true;
    document.body.classList.add('cursor-crosshair');

    const {
      elLeftReferencePoint,
      elTopReferencePoint,
      elRightReferencePoint,
      elBottomReferencePoint,
      pointGap
    } = getReferencePoints(window, contentEl, $verticalMode$, firstDimensionMargin);

    merge(fromEvent(document, 'pointerup'), fromEvent(document, 'pointermove'))
      // eslint-disable-next-line rxjs/no-ignored-takewhile-value
      .pipe(takeWhile(() => isSelectingCustomReadingPoint))
      .subscribe((event: Event) => {
        if (!(event instanceof PointerEvent)) {
          return;
        }

        if (event.type === 'pointerup') {
          document.body.classList.remove('cursor-crosshair');
          isSelectingCustomReadingPoint = false;

          tick().then(() => {
            customReadingPointLeft = $verticalMode$ ? event.x : customReadingPointLeft;
            customReadingPointTop = $verticalMode$ ? customReadingPointTop : event.y;

            const result = getParagraphToPoint(customReadingPointLeft, customReadingPointTop);

            if (result) {
              pulseElement(result.parent, 'add', 0.5, 500);
            }

            if (isPaginated) {
              customReadingPointRange = result?.range;
            } else {
              let newPercentage = 0;

              if ($verticalMode$) {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointLeft - elLeftReferencePoint) /
                    (elRightReferencePoint - elLeftReferencePoint)) *
                    100
                );

                verticalCustomReadingPosition$.next(newPercentage);
              } else {
                newPercentage = Math.ceil(
                  (Math.max(0, customReadingPointTop - elTopReferencePoint) /
                    (elBottomReferencePoint - elTopReferencePoint)) *
                    100
                );

                horizontalCustomReadingPosition$.next(newPercentage);
              }

              customReadingPoint = newPercentage;
            }

            if ($pauseTrackerOnCustomPointChange$) {
              restartTrackerAfterCharacterChangeOrTime(1000);
            }
          });
        } else {
          const insideXBound =
            event.x >= elLeftReferencePoint + pointGap && event.x <= elRightReferencePoint;
          const insideYBound =
            event.y >= elTopReferencePoint && event.y <= elBottomReferencePoint - pointGap;

          if (isPaginated) {
            customReadingPointTop = insideYBound ? event.y : customReadingPointTop;
            customReadingPointLeft = insideXBound ? event.x : customReadingPointLeft;
          } else if ($verticalMode$ && insideXBound) {
            customReadingPointLeft = event.x;
          } else if (!$verticalMode$ && insideYBound) {
            customReadingPointTop = event.y;
          }
        }
      });
  }

  function pauseTracker(restartAfterCharacterChange = false) {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      wasTrackerPaused = false;
      $isTrackerPaused$ = true;

      if (restartAfterCharacterChange) {
        restartTrackerAfterCharacterChangeOrTime();
      }
    }
  }

  function restartTrackerAfterCharacterChangeOrTime(timerAmount = 0) {
    if (!$statisticsEnabled$ || wasTrackerPaused) {
      return;
    }

    merge(fromEvent(document, PAGE_CHANGE), timerAmount ? timer(timerAmount) : NEVER)
      .pipe(debounceTime(200), take(1))
      .subscribe(() => {
        wasTrackerPaused = false;
        $isTrackerPaused$ = false;
      });
  }

  function scheduleReplication(dataType: StorageDataType) {
    if (upSyncEnabled) {
      const toReplicate = isReplicating ? dataToReplicateQueue : dataToReplicate;

      if (!toReplicate.includes(dataType)) {
        toReplicate.push(dataType);
      }

      if (!isReplicating) {
        dataToReplicate = [...dataToReplicate];
      }

      if (!blockDataUpdates) {
        executeReplicate$.next();
      }
    }
  }
</script>

<svelte:head>
  <title>{formatPageTitle($rawBookData$?.title ?? '')}</title>
</svelte:head>

{$collectReaderImageGallerySpoilerToggles$ ?? ''}
{$handleUpdateImageGalleryPictureSpoilers$ ?? ''}
{#if !showSpinner && !isPaginated}
  <AutoScrollFab {autoScroller} />
{/if}
{#if !showSpinner && isPaginated}
  <AutoReaderFab {autoReader} seekCharCount={ttsSeekCharCount} resumePosition={ttsResumePosition} />
{/if}
<div
  class="fixed inset-x-0 top-0 z-10 h-12 w-full"
  role="button"
  tabindex="-1"
  aria-label="显示阅读器菜单"
  on:mouseenter={() => {
    clearTimeout(headerEnterTimer);
    headerEnterTimer = setTimeout(() => (showHeader = true), 200);
  }}
  on:mouseleave={() => clearTimeout(headerEnterTimer)}
  on:click={() => (showHeader = true)}
  on:keyup={dummyFn}
></div>
{#if showHeader}
  <div
    class="elevation-4 writing-horizontal-tb fixed inset-x-0 top-0 z-10 w-full"
    transition:fly|local={{ y: -300, duration: 180, easing: quintInOut }}
    use:clickOutside={() => (showHeader = false)}
  >
    <BookReaderHeader
      hasChapterData={!!$sectionData$?.length}
      hasText={!!bookCharCount}
      hasCustomReadingPoint={!!(
        ($customReadingPointEnabled$ || isPaginated) &&
        ((isPaginated && customReadingPointRange) ||
          (!isPaginated && customReadingPointLeft > -1 && customReadingPointTop > -1))
      )}
      showFullscreenButton={fullscreenManager.fullscreenEnabled}
      autoScrollMultiplier={$multiplier$}
      {hasBookmarkData}
      bind:isBookmarkScreen
      on:tocClick={() => {
        pauseTracker();

        showHeader = false;
        tocIsOpen$.next(true);
      }}
      on:highlightClick={() => {
        pauseTracker();
        showHeader = false;
        highlightSidebarOpen$.next(true);
      }}
      on:jumpClick={handleJump}
      on:completeBook={completeBook}
      on:setCustomReadingPoint={handleSetCustomReadingPoint}
      on:showCustomReadingPoint={() => {
        showHeader = false;
        showCustomReadingPoint = true;
      }}
      on:resetCustomReadingPoint={() => {
        showHeader = false;

        if ($pauseTrackerOnCustomPointChange$) {
          pauseTracker();
        }

        if (isPaginated) {
          customReadingPointRange = undefined;
        } else if ($verticalMode$) {
          verticalCustomReadingPosition$.next(100);
          customReadingPoint = 100;
        } else {
          horizontalCustomReadingPosition$.next(0);
          customReadingPoint = 0;
        }

        if ($pauseTrackerOnCustomPointChange$) {
          restartTrackerAfterCharacterChangeOrTime(1000);
        }
      }}
      on:fullscreenClick={onFullscreenClick}
      on:bookmarkClick={bookmarkPage}
      on:scrollToBookmarkClick={() => {
        showHeader = false;
        scrollToBookmark();
      }}
      on:statisticsClick={() => {
        if ($rawBookData$) {
          $preFilteredTitlesForStatistics$ = new Set([$rawBookData$.title]);
        }

        leaveReader(mergeEntries.STATISTICS.routeId, false);
      }}
      on:readerImageGalleryClick={() => {
        showHeader = false;
        showReaderImageGallery = true;
      }}
      on:settingsClick={() => leaveReader(mergeEntries.SETTINGS.routeId, false)}
      on:domainHintClick={onDomainHintClick}
      on:bookManagerClick={() => leaveReader(mergeEntries.MANAGE.routeId)}
    />
  </div>
{/if}

{#if $bookData$ && $rawBookData$}
  {#if $statisticsEnabled$}
    <BookReadingTracker
      fontColor={$themeOption$.fontColor}
      backgroundColor={$backgroundColor$}
      bookTitle={$rawBookData$.title}
      sectionData={$sectionData$}
      {frozenPosition}
      {exploredCharCount}
      {bookCharCount}
      {autoScroller}
      {blockDataUpdates}
      bind:wasTrackerPaused
      bind:this={trackerElm}
      on:freezeCurrentLocation={freezeTrackerPosition}
      on:statisticsSaved={() => {
        if (!blockDataUpdates) {
          scheduleReplication(StorageDataType.STATISTICS);
        }
      }}
      on:trackerAvailable={() => (showTrackerIcon = true)}
      on:trackerMenuClosed={() => {
        if (!wasTrackerPaused) {
          isTrackerPaused$.next(false);
        }

        isTrackerMenuOpen$.next(false);

        bookCompleted = false;
      }}
    />
  {/if}
  <StyleSheetRenderer styleSheet={$bookData$.styleSheet} />
  <BookReader
    htmlContent={$bookData$.htmlContent}
    language={$bookData$?.language}
    width={$containerViewportWidth$ ?? 0}
    height={$containerViewportHeight$ ?? 0}
    {fontFeatureSettings}
    {verticalTextOrientation}
    prioritizeReaderStyles={$prioritizeReaderStyles$}
    enableTextJustification={$enableTextJustification$}
    enableTextWrapPretty={$enableTextWrapPretty$}
    verticalMode={$verticalMode$}
    fontColor={$themeOption$?.fontColor}
    backgroundColor={$backgroundColor$}
    hintFuriganaFontColor={$themeOption$?.hintFuriganaFontColor}
    hintFuriganaShadowColor={$themeOption$?.hintFuriganaShadowColor}
    fontFamilyGroupOne={$fontFamilyGroupOne$}
    fontFamilyGroupTwo={$fontFamilyGroupTwo$}
    fontWeight={$fontWeight$}
    fontSize={$fontSize$}
    lineHeight={$lineHeight$}
    textIndentation={$textIndentation$}
    textMarginMode={$textMarginMode$}
    textMarginValue={$textMarginValue$}
    hideSpoilerImage={$hideSpoilerImage$}
    hideFurigana={$hideFurigana$}
    furiganaStyle={$furiganaStyle$}
    viewMode={$viewMode$}
    secondDimensionMaxValue={$secondDimensionMaxValue$}
    {firstDimensionMargin}
    autoPositionOnResize={$autoPositionOnResize$}
    avoidPageBreak={$avoidPageBreak$}
    pageColumns={$pageColumns$}
    autoBookmark={$autoBookmark$}
    autoBookmarkTime={$autoBookmarkTime$}
    multiplier={$multiplier$}
    bind:exploredCharCount
    bind:bookCharCount
    bind:isBookmarkScreen
    bind:bookmarkData
    bind:autoScroller
    bind:autoReader
    bind:currentSectionIndex
    bind:sectionStartCharCount
    bind:bookmarkManager
    bind:pageManager
    bind:customReadingPoint
    bind:customReadingPointTop
    bind:customReadingPointLeft
    bind:customReadingPointScrollOffset
    bind:customReadingPointRange
    bind:showCustomReadingPoint
    on:bookmark={bookmarkPage}
    on:trackerPause={() => pauseTracker(true)}
  />
  {$initBookmarkData$ ?? ''}
  {$setBackgroundColor$ ?? ''}
  {$setWritingMode$ ?? ''}
  {$textSelector$ ?? ''}
  {$replicator$ ?? ''}
  {$autoStartTracker$ ?? ''}
{:else}
  {$leaveIfBookMissing$ ?? ''}
{/if}

{#if $tocIsOpen$ && $sectionData$}
  <div
    class="writing-horizontal-tb fixed top-0 left-0 z-[60] flex h-full w-full max-w-xl flex-col justify-between"
    style:color={$themeOption$?.fontColor}
    style:background-color={$backgroundColor$}
    in:fly|local={{ x: -100, duration: 100, easing: quintInOut }}
    use:clickOutside={() => {
      if ($statisticsEnabled$ && !wasTrackerPaused) {
        isTrackerPaused$.next(false);
      }
      tocIsOpen$.next(false);
    }}
  >
    <BookToc
      sectionData={$sectionData$}
      verticalMode={$verticalMode$}
      {exploredCharCount}
      {wasTrackerPaused}
    />
  </div>
{/if}

{#if $highlightSidebarOpen$}
  <HighlightSidebar
    highlights={$hlStore$}
    sections={$sectionData$ || []}
    on:navigate={({ detail }) => handleHlNavigate(detail)}
    on:editMemo={({ detail }) => handleHlSidebarEditMemo(detail)}
    on:delete={({ detail }) => handleHlSidebarDelete(detail)}
    on:close={() => {
      if ($statisticsEnabled$ && !wasTrackerPaused) {
        isTrackerPaused$.next(false);
      }
      highlightSidebarOpen$.next(false);
    }}
  />
{/if}

<HighlightContextMenu
  x={hlMenuX}
  y={hlMenuY}
  visible={hlMenuVisible}
  mode={hlMenuMode}
  hasMemo={hlEditTarget?.memo ? true : false}
  on:color={({ detail }) => handleHlColor(detail)}
  on:memo={handleHlMemoRequest}
  on:editMemo={handleHlEditMemoRequest}
  on:delete={handleHlDelete}
  on:close={() => { hlMenuVisible = false; hlEditTarget = undefined; }}
/>

{#if hlMemoDialogOpen}
  <HighlightMemoDialog
    memo={hlMemoText}
    selectedText={hlMemoSelectedText}
    on:save={({ detail }) => handleHlMemoSave(detail)}
    on:cancel={() => { hlMemoDialogOpen = false; hlEditTarget = undefined; skipKeyDownListener$.next(false); }}
  />
{/if}

{#if showReaderImageGallery}
  <BookReaderImageGallery
    fontColor={$themeOption$.fontColor}
    backgroundColor={$backgroundColor$}
    on:close={() => (showReaderImageGallery = false)}
  />
{/if}

{#if (isSelectingCustomReadingPoint && !$isMobile$) || (!isPaginated && showCustomReadingPoint)}
  <div
    class="fixed left-0 z-20 h-[1px] w-full border border-red-500"
    style:top={`${customReadingPointTop}px`}
  />
  <div
    class="fixed top-0 z-20 h-full w-[1px] border border-red-500"
    style:left={`${customReadingPointLeft}px`}
  />
{/if}

{#if $enableTapEdgeToFlip$ && isPaginated && !$skipKeyDownListener$}
  <button
    class="fixed left-0 z-10 w-5"
    on:click={$verticalMode$ ? () => pageManager?.nextPage() : () => pageManager?.prevPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  />
  <button
    class="fixed right-0 z-10 w-5"
    on:click={$verticalMode$ ? () => pageManager?.prevPage() : () => pageManager?.nextPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
  />
{/if}

{#if showSpinner}
  <div class="fixed inset-0 flex h-full w-full items-center justify-center text-7xl">
    <Fa icon={faSpinner} spin />
  </div>
{/if}

<div
  id="ttu-page-footer"
  tabindex="0"
  role="button"
  class="writing-horizontal-tb fixed bottom-0 left-0 z-10 flex h-8 w-full items-center justify-between text-xs leading-none"
  style:color={$themeOption$?.tooltipTextFontColor}
  on:click={() => (showFooter = !showFooter)}
  on:keyup={dummyFn}
>
  <div class="flex h-full">
    {#if showTrackerIcon}
      <div
        role="button"
        title="单击打开统计菜单，双击切换统计"
        class="flex h-full w-8 items-center justify-center text-sm sm:text-lg"
        class:text-red-500={$isTrackerPaused$}
        class:animate-pulse={frozenPosition > -1}
        use:multiClickHandler={[trackerSingleClickHandler, trackerDblClickHandler]}
      >
        <Fa icon={$isTrackerPaused$ ? faPlay : faPause} />
      </div>
    {/if}
    {#if dataToReplicate.length}
      <div
        tabindex="0"
        role="button"
        class="flex h-full w-8 items-center justify-center text-sm sm:text-lg"
        class:text-red-500={externalStorageErrors > 1}
        class:animate-pulse={externalStorageErrors > 1 || isReplicating}
        on:click|stopPropagation={() => {
          if ($statisticsEnabled$) {
            wasTrackerPaused = $isTrackerPaused$;
            isTrackerPaused$.next(true);
          }

          executeReplication(false).finally(() => {
            if ($statisticsEnabled$ && !wasTrackerPaused) {
              isTrackerPaused$.next(false);
            }
          });
        }}
        on:keyup={dummyFn}
      >
        <Fa icon={faCloudBolt} />
      </div>
    {/if}
  </div>
  {#if showFooter && bookCharCount}
    {@const currentProgress = [
      $showCharacterCounter$ ? `${exploredCharCount} / ${bookCharCount}` : '',
      $showPercentage$ ? `${((exploredCharCount / bookCharCount) * 100).toFixed(2)}%` : '',
      $showFooterChapterCharacterCounter$ || $showFooterChapterPercentage$ ? 'T' : ''
    ]
      .filter(Boolean)
      .join(' ')}
    <div
      tabindex="0"
      role="button"
      title="点击复制进度"
      class="writing-horizontal-tb fixed bottom-2 right-2 z-10 text-xs leading-none select-none whitespace-pre"
      class:invisible={!$showCharacterCounter$ &&
        !$showPercentage$ &&
        !$showFooterChapterCharacterCounter$ &&
        !$showFooterChapterPercentage$}
      style:color={$themeOption$?.tooltipTextFontColor}
      on:click|stopPropagation={({ target }) => {
        if (!$showCharacterCounter$ && !$showPercentage$) {
          return;
        }

        copyCurrentProgress(currentProgress.replace(/ T$/, ''));

        if (target instanceof HTMLElement) {
          pulseElement(target.parentElement || target, 'add', 0.5, 500);
        }
      }}
      on:keyup={dummyFn}
    >
      <span class="mr-4" class:invisible={!footerChapterProgress}>{footerChapterProgress}</span>
      <span class:invisible={!$showCharacterCounter$ && !$showPercentage$}>{currentProgress}</span>
    </div>
  {/if}
</div>

{#if bookCompleted}
  <BookCompletionConfetti {confettiWidthModifier} {confettiMaxRuns} {window} />
{/if}

<svelte:window
  on:keydown={onKeydown}
  on:beforeunload={handleUnload}
  on:resize={() => {
    if ($statisticsEnabled$ && !$isTrackerPaused$) {
      pauseTracker();

      merge(fromEvent(document, PAGE_CHANGE), timer(1000))
        .pipe(debounceTime(1000), take(1))
        .subscribe(() => {
          restartTrackerAfterCharacterChangeOrTime(1000);
        });
    }
  }}
/>
