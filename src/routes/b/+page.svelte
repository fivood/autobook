<script context="module" lang="ts">
  // Survives /b unmount so navigating to /settings and back doesn't re-format the book.
  // Keyed on (bookId, viewMode, blurMode, lastBookmarkModified). Only the latest entry is kept
  // to avoid leaking object URLs from prior books.
  //
  // We also own the lifecycle of the entry's blob object URLs: when an entry
  // is evicted (via clear() or replaced), revoke its URLs here. Doing the
  // revocation in `format-book-data-html.ts`'s observable teardown (the
  // previous design) tore URLs down the moment the BookReader unmounted —
  // which is also when /b → /settings → /b lands a cache hit pointing at
  // dead URLs, so every <img> rendered as a broken-image icon
  // (`naturalWidth: 0`).
  interface FormattedBookEntry {
    htmlContent: string;
    styleSheet: string;
    language?: string;
    objectUrls: string[];
  }
  const formattedBookCache = new Map<string, FormattedBookEntry>();
  function evictFormattedBookCache() {
    for (const entry of formattedBookCache.values()) {
      for (const url of entry.objectUrls) {
        URL.revokeObjectURL(url);
      }
    }
    formattedBookCache.clear();
  }
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
  import { TtsHighlighter } from '$lib/components/book-reader/tts-highlight';
  import { quintInOut } from 'svelte/easing';
  import { fade, fly } from 'svelte/transition';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import {
    faChevronLeft,
    faChevronRight,
    faCloudBolt,
    faPause,
    faPlay,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
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
  import PdfOcrBanner from '$lib/components/book-reader/pdf-ocr-banner.svelte';
  import PdfPageContextMenu from '$lib/components/book-reader/pdf-page-context-menu.svelte';
  import KeyboardShortcutsHelp from '$lib/components/book-reader/keyboard-shortcuts-help.svelte';
  import BookImageZoom from '$lib/components/book-reader/book-image-zoom.svelte';
  import { isScannedPdf } from '$lib/functions/file-loaders/pdf/pdf-ocr-runner';
  import HighlightContextMenu from '$lib/components/book-reader/book-highlight/highlight-context-menu.svelte';
  import HighlightMemoDialog from '$lib/components/book-reader/book-highlight/highlight-memo-dialog.svelte';
  import HighlightSidebar from '$lib/components/book-reader/book-highlight/highlight-sidebar.svelte';
  // Lazy-load the AI drawer module on first open. ~300 lines of Svelte
  // template + downstream markdown/highlight deps; users who never open
  // the AI panel never pay the parse cost on cold start.
  import type AiReaderDrawerComponent from '$lib/components/ai/ai-reader-drawer.svelte';
  let AiReaderDrawer: typeof AiReaderDrawerComponent | null = null;
  async function loadAiDrawer() {
    if (!AiReaderDrawer) {
      AiReaderDrawer = (await import('$lib/components/ai/ai-reader-drawer.svelte')).default;
    }
  }
  import DictPopup from '$lib/components/dict/dict-popup.svelte';
  import { dictFolderPath$ } from '$lib/data/store';
  import { scanDictFolder, loadedDicts$ } from '$lib/data/dict/dict-manager';
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
  import type BookReaderImageGalleryComponent from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte';
  let BookReaderImageGallery: typeof BookReaderImageGalleryComponent | null = null;
  async function loadImageGallery() {
    if (!BookReaderImageGallery) {
      BookReaderImageGallery = (
        await import('$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery.svelte')
      ).default;
    }
  }
  import {
    getDefaultStatistic,
    isTrackerMenuOpen$,
    isTrackerPaused$
  } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
  // 874 lines of template + stats logic — the heaviest single component
  // gated behind the statistics-enabled toggle. We still want to load it
  // as soon as a stats-tracked book is opened, but doing it asynchronously
  // means initial parse / hydration of the page doesn't block on it.
  import type BookReadingTrackerComponent from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker.svelte';
  let BookReadingTracker: typeof BookReadingTrackerComponent | null = null;
  async function loadReadingTracker() {
    if (!BookReadingTracker) {
      BookReadingTracker = (
        await import('$lib/components/book-reader/book-reading-tracker/book-reading-tracker.svelte')
      ).default;
    }
  }
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
  let trackerElm: BookReadingTrackerComponent;
  // Kick off the lazy tracker load as soon as the reader confirms stats
  // tracking is enabled. Page hydration finishes first; the tracker arrives
  // a tick later without blocking initial render.
  $: if (browser && $statisticsEnabled$ && !BookReadingTracker) {
    loadReadingTracker();
  }
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
  let hlMemoTags: string[] = [];
  let aiDrawerOpen = false;
  let dictPopupOpen = false;
  let dictPopupWord = '';
  let dictPopupX = 0;
  let dictPopupY = 0;
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
        bookData = await localStorageHandler.getBook();

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
          externalStorageHandler = await getStorageHandlerByName(bookData.storageSource, true);
        } else if ($autoReplication$ !== AutoReplicationType.Off) {
          externalStorageHandler = await getStorageHandlerByName($syncTarget$);
        }

        bookData.lastBookOpen = new Date().getTime();

        await localStorageHandler.updateLastRead(bookData);

        await syncDownData(externalStorageHandler, currentContext);

        if (!$statisticsEnabled$) {
          const wasNew = (
            await database.setFirstBookRead(currentContext.title, $startDayHoursForTracker$)
          )[1];

          if (wasNew) {
            scheduleReplication(StorageDataType.STATISTICS);
          }
        }

        bookData = await saveExternalLastRead(externalStorageHandler, bookData);

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
        syncedResolver();

        showSpinner = false;
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
      if (!rawBookData) return EMPTY;

      sectionList$.next(rawBookData.sections || []);
      initHighlightManager(database, rawBookData.id, rawBookData.title);

      const isPaginated = $viewMode$ === ViewMode.Paginated;
      const cacheKey = `${rawBookData.id}|${isPaginated ? 'p' : 'c'}|${$hideSpoilerImageMode$}|${rawBookData.lastBookModified || 0}`;
      const cached = formattedBookCache.get(cacheKey);
      if (cached) {
        return of(cached);
      }

      return loadBookData(
        rawBookData,
        '.book-content',
        document,
        isPaginated,
        $hideSpoilerImageMode$
      ).pipe(
        tap((data) => {
          // Only keep the latest entry. evictFormattedBookCache revokes
          // the prior entry's blob URLs as it clears — safe now because
          // formatBookDataHtml hands URL ownership to this cache instead
          // of revoking them on observable teardown.
          evictFormattedBookCache();
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
  const ttsHighlighter = new TtsHighlighter();

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

  $: if (autoReader && autoReader !== ttsWiredReader && browser) {
    ttsWiredReader = autoReader;
    autoReader.onBoundary = (charIndex) => {
      // Update the current-sentence visual highlight (CSS Custom Highlight
      // API, no DOM mutation). Works in both view modes.
      const sentence = autoReader?.getCurrentSentence?.();
      if (sentence) {
        ttsHighlighter.setRange(sentence.globalStart, sentence.globalEnd);
      }

      if (typeof charIndex === 'number') {
        if (isPaginated) {
          // Auto-page-flip: whatever the TTS engine is about to speak should
          // be on-screen. charIndex is a section-local offset into
          // extractText()'s raw string (counts whitespace, punctuation, …).
          // The paginated calculator uses getCharacterCount() which strips
          // those — translate before handing it over so we don't drift off
          // the section end.
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
        } else {
          // Continuous mode: TTS drives the typewriter reveal so visible
          // text stays in sync with the voice. Pull characters up to
          // charIndex out of hidden state and ensure the active sentence is
          // scrolled into view.
          autoScroller?.seekToCharIndex?.(charIndex);
          if (sentence) scrollSentenceIntoView(sentence.globalStart);
        }
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
      if (enabled) {
        const el = document.querySelector('.book-content') as HTMLElement | null;
        if (!isPaginated) {
          // Hide chars so TTS boundaries can reveal them char-by-char in
          // pace with the voice (matches the typewriter pattern).
          autoScroller?.prepare?.();
          autoScroller?.off?.();
        }
        ttsHighlighter.prepare(el || undefined);
      } else {
        ttsHighlighter.clear();
        if (!isPaginated) {
          // TTS stopped: make sure the rest of the book is visible again
          // (otherwise the user is stuck with whatever was revealed so far).
          autoScroller?.revealAll?.();
        }
      }
      // Pausing saves the precise spot (throttled boundary saves lag ~2s).
      if (!enabled && ttsWiredReader === autoReader) persistTtsPosition();
    });
  }

  function scrollSentenceIntoView(globalIdx: number) {
    if (typeof window === 'undefined') return;
    const root = document.querySelector('.book-content') as HTMLElement | null;
    if (!root) return;
    // Walk text nodes and find the one containing globalIdx. Then scroll
    // its parent into view roughly centered. Throttle via the position
    // matching .tw-c spans when typewriter is active.
    const twcSpans = root.querySelectorAll<HTMLElement>('.tw-c');
    let target: Element | null = null;
    if (twcSpans.length > 0) {
      const i = Math.min(globalIdx, twcSpans.length - 1);
      target = twcSpans[i];
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let total = 0;
      let node: Node | null = walker.nextNode();
      while (node) {
        const text = node.textContent || '';
        if (total + text.length >= globalIdx) {
          target = node.parentElement;
          break;
        }
        total += text.length;
        node = walker.nextNode();
      }
    }
    if (target) {
      const rect = target.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      if (rect.top < vh * 0.2 || rect.bottom > vh * 0.7) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
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

  /** Width of each edge tap zone. We tie it to the user-configured margin
   * so the zone naturally fills the no-text gap on either side of the
   * page — bigger margin → bigger hit area, no extra setting to tune.
   *
   * Horizontal reading: the side gap is `(viewport - secondDimensionMaxValue) / 2`
   * when a max content-width cap is set; if not, fall back to a discoverable
   * minimum (5rem ≈ a thumb's worth).
   * Vertical reading: `firstDimensionMargin` is literally the left/right
   * padding around the rotated text, so use it directly.
   */
  $: tapEdgeWidthPx = (() => {
    if (!browser) return 80;
    const min = convertRemToPixels(window, 5);
    if ($verticalMode$) {
      return Math.max(min, $firstDimensionMargin$ ?? 0);
    }
    const cap = $secondDimensionMaxValue$ ?? 0;
    const viewportW = $containerViewportWidth$ ?? window.innerWidth;
    if (!cap || cap >= viewportW) return min;
    return Math.max(min, Math.floor((viewportW - cap) / 2));
  })();

  $: tapEdgeWidth = `${tapEdgeWidthPx}px`;

  // Visual page-turn hint: a circular chevron button that fades in when
  // the cursor approaches either edge of the viewport. Pure UX
  // discoverability — the wider invisible tap-edge button under it
  // already handles the click, the floating chevron just tells the user
  // "yes, this side flips a page". Auto-hides 1.2s after the cursor
  // leaves the trigger zone, so the page stays visually clean while
  // reading.
  let leftHintVisible = false;
  let rightHintVisible = false;
  let edgeHintTimer: ReturnType<typeof setTimeout> | undefined;

  function onWindowPointerMove(ev: PointerEvent) {
    if (!isPaginated || !$enableTapEdgeToFlip$ || $skipKeyDownListener$) {
      leftHintVisible = false;
      rightHintVisible = false;
      return;
    }
    const w = window.innerWidth;
    // Trigger zone matches the tap-edge button: the hint shows whenever
    // the cursor is inside the zone that would actually flip the page on
    // click.
    const zone = tapEdgeWidthPx;
    leftHintVisible = ev.clientX < zone;
    rightHintVisible = ev.clientX > w - zone;
    clearTimeout(edgeHintTimer);
    if (leftHintVisible || rightHintVisible) {
      edgeHintTimer = setTimeout(() => {
        leftHintVisible = false;
        rightHintVisible = false;
      }, 1200);
    }
  }

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

    let { id, ...bookData } = localBookData;

    if (localBookData.storageSource) {
      const externalBookData = await storageHandler.getBook();

      if (externalBookData instanceof File) {
        throw new Error(
          `外部书籍数据格式错误（返回了文件而非解析后的数据）：${localBookData.title}`
        );
      }

      if (externalBookData) {
        // Prefer the fresher of (IDB local) vs (external disk) by
        // lastBookModified. Without this guard, any local-only mutation —
        // most importantly an OCR run that writes to IDB but hasn't been
        // pushed to FS yet — gets silently clobbered the next time the
        // book is opened, because the stale disk copy unconditionally
        // overrides the fresher local one. Symptom: OCR'd PDFs lose their
        // <p class="pdf-ocr-text"> paragraphs the moment the user reloads.
        const localTs = localBookData.lastBookModified || 0;
        const externalTs = externalBookData.lastBookModified || 0;
        if (externalTs >= localTs) {
          bookData = {
            ...externalBookData,
            ...{
              id: localBookData.id,
              lastBookOpen: localBookData.lastBookOpen,
              storageSource: localBookData.storageSource
            }
          };
        }
        // else: localBookData is newer — keep what IDB gave us. The user
        // can replicate up to external storage later via the normal export
        // flow if they want disk parity.
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
      hlMemoTags = [];
      hlPendingColor = 'yellow';
      hlMemoDialogOpen = true;
      skipKeyDownListener$.next(true);
    }
    hlMenuVisible = false;
  }

  function handleHlLookup() {
    if (!hlPendingRange) {
      hlMenuVisible = false;
      return;
    }
    const text = hlPendingRange.toString().trim();
    if (!text) {
      hlMenuVisible = false;
      return;
    }
    dictPopupWord = text;
    dictPopupX = hlMenuX;
    dictPopupY = hlMenuY + 30;
    dictPopupOpen = true;
    hlMenuVisible = false;
  }

  function handleHlEditMemoRequest() {
    if (hlEditTarget) {
      hlMemoSelectedText = hlEditTarget.text;
      hlMemoText = hlEditTarget.memo;
      hlMemoTags = hlEditTarget.tags || [];
      skipKeyDownListener$.next(true);
      hlMemoDialogOpen = true;
    }
    hlMenuVisible = false;
  }

  async function handleHlMemoSave(payload: { memo: string; tags: string[] }) {
    const { memo, tags } = payload;
    const container = getBookContentEl();
    if (!container) return;

    if (hlEditTarget) {
      await updateHl(hlEditTarget.id, { memo, tags });
      hlEditTarget = undefined;
    } else if (hlPendingRange) {
      const offsets = rangeToOffsets(container, hlPendingRange);
      if (offsets) {
        const text = hlPendingRange.toString();
        await addHl(offsets.start, offsets.end, text, hlPendingColor, memo, tags);
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
{#if !showSpinner}
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
{#if $rawBookData$ && isScannedPdf($rawBookData$)}
  <PdfOcrBanner
    book={$rawBookData$}
    on:updated={() => window.location.reload()}
  />
{/if}
{#if $rawBookData$ && !isPaginated && /pdf-page-img|cbz-img/.test($rawBookData$.elementHtml || '')}
  <BookImageZoom />
{/if}
{#if $rawBookData$ && /data-pdf-page=/.test($rawBookData$.elementHtml || '')}
  <PdfPageContextMenu book={$rawBookData$} />
{/if}
{#if $rawBookData$}
  <KeyboardShortcutsHelp />
{/if}

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
      on:aiClick={async () => {
        pauseTracker();
        showHeader = false;
        await loadAiDrawer();
        aiDrawerOpen = true;
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
      on:readerImageGalleryClick={async () => {
        showHeader = false;
        await loadImageGallery();
        showReaderImageGallery = true;
      }}
      on:settingsClick={() => leaveReader(mergeEntries.SETTINGS.routeId, false)}
      on:domainHintClick={onDomainHintClick}
      on:bookManagerClick={() => leaveReader(mergeEntries.MANAGE.routeId)}
    />
  </div>
{/if}

{#if $bookData$ && $rawBookData$}
  {#if $statisticsEnabled$ && BookReadingTracker}
    <svelte:component
      this={BookReadingTracker}
      fontColor={$themeOption$.fontColor}
      backgroundColor={$backgroundColor$}
      bookTitle={$rawBookData$.title}
      sectionData={$sectionData$}
      isPdfBook={!!$rawBookData$.sections?.[0]?.reference?.startsWith('pdf-page-')}
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

{#if aiDrawerOpen && $rawBookData$ && AiReaderDrawer}
  <svelte:component
    this={AiReaderDrawer}
    bookId={$rawBookData$.id}
    bookTitle={$rawBookData$.title}
    elementHtml={$rawBookData$.elementHtml}
    {exploredCharCount}
    {bookCharCount}
    on:close={() => (aiDrawerOpen = false)}
  />
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
  on:lookup={handleHlLookup}
  on:delete={handleHlDelete}
  on:close={() => { hlMenuVisible = false; hlEditTarget = undefined; }}
/>

{#if dictPopupOpen}
  <DictPopup
    word={dictPopupWord}
    x={dictPopupX}
    y={dictPopupY}
    on:close={() => (dictPopupOpen = false)}
  />
{/if}

{#if hlMemoDialogOpen}
  <HighlightMemoDialog
    memo={hlMemoText}
    selectedText={hlMemoSelectedText}
    tags={hlMemoTags}
    on:save={({ detail }) => handleHlMemoSave(detail)}
    on:cancel={() => { hlMemoDialogOpen = false; hlEditTarget = undefined; skipKeyDownListener$.next(false); }}
  />
{/if}

{#if showReaderImageGallery && BookReaderImageGallery}
  <svelte:component
    this={BookReaderImageGallery}
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
    class="fixed left-0 z-10"
    on:click={$verticalMode$ ? () => pageManager?.nextPage() : () => pageManager?.prevPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
    style:width={tapEdgeWidth}
  />
  <button
    class="fixed right-0 z-10"
    on:click={$verticalMode$ ? () => pageManager?.prevPage() : () => pageManager?.nextPage()}
    style:height={tapButtonHeight}
    style:top={tapButtonTop}
    style:width={tapEdgeWidth}
  />
  <!-- Visual edge-flip hint. Pointer-events disabled because the clickable
       target is the big invisible button above; the chevron just signals
       "this side flips a page". -->
  {#if leftHintVisible}
    <div
      class="edge-flip-hint left"
      style:top={tapButtonTop}
      style:left="0.75rem"
      transition:fade={{ duration: 180 }}
    >
      <Fa icon={$verticalMode$ ? faChevronRight : faChevronLeft} />
    </div>
  {/if}
  {#if rightHintVisible}
    <div
      class="edge-flip-hint right"
      style:top={tapButtonTop}
      style:right="0.75rem"
      transition:fade={{ duration: 180 }}
    >
      <Fa icon={$verticalMode$ ? faChevronLeft : faChevronRight} />
    </div>
  {/if}
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
  on:pointermove={onWindowPointerMove}
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

<style lang="scss">
  // Visual page-flip hint that fades in when the cursor enters the edge
  // tap zone. Pure UX: the wider invisible button under it handles the
  // actual click. `pointer-events: none` keeps it out of selection / drag
  // paths so reading and highlighting feel untouched.
  .edge-flip-hint {
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.32);
    color: rgba(255, 255, 255, 0.88);
    font-size: 1.1rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 11;
    pointer-events: none;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    // Vertical center inside the tap-button band (tapButtonTop -> bottom);
    // translateY moves the chevron off the band's top to its visual middle.
    transform: translateY(40vh);
  }
</style>
