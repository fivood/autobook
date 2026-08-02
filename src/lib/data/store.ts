/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '$app/environment';
import {
  ReaderImageGalleryAvailableKeybind,
  type ReaderImageGalleryKeybindMap
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import {
  ReadingGoalFrequency,
  TrackerAutoPause,
  TrackerSkipThresholdAction
} from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import {
  StatisticsRangeTemplate,
  StatisticsTab,
  type BookStatistic,
  StatisticsReadingDataAggregationMode
} from '$lib/components/statistics/statistics-types';
import { BlurMode } from '$lib/data/blur-mode';
import type { UserFont } from '$lib/data/fonts';
import { MergeMode } from '$lib/data/merge-mode';
import type { ReadingGoal } from '$lib/data/reading-goal';
import { SortDirection, type SortOption } from '$lib/data/sort-types';
import {
  StatisticsTabAvailableKeybind,
  type StatisticsTabKeybindMap
} from '$lib/data/statistics-tab-keybind';
import {
  InternalStorageSources,
  StorageDataType,
  StorageKey
} from '$lib/data/storage/storage-types';
import {
  AutoReplicationType,
  ReplicationSaveBehavior
} from '$lib/functions/replication/replication-options';
import { writableSubject } from '$lib/functions/svelte/store';
import { map } from 'rxjs';
import { BookReaderAvailableKeybind, type BookReaderKeybindMap } from './book-reader-keybind';
import { DatabaseService } from './database/books-db/database.service';
import { createBooksDb } from './database/books-db/factory';
import { FuriganaStyle } from './furigana-style';
import { ImportHTMLFixMode } from './import-html-fix-mode';
import { writableBooleanLocalStorageSubject } from './internal/writable-boolean-local-storage-subject';
import { writableNumberLocalStorageSubject } from './internal/writable-number-local-storage-subject';
import { writableNumberOrNullLocalStorageSubject } from './internal/writable-number-or-null-local-storage-subject';
import {
  writableArrayLocalStorageSubject,
  writableObjectLocalStorageSubject
} from './internal/writable-object-local-storage-subject';
import type { TextMarginMode } from './text-margin-mode';
import type { ThemeOption } from './theme-option';
import type { VerticalTextOrientation } from './vertical-text-orientation';
import { ViewMode } from './view-mode';
import type { WritingMode } from './writing-mode';
import { writableSetLocalStorageSubject } from './internal/writable-set-local-storage-subject';
import { writableStringLocalStorageSubject } from './internal/writable-string-local-storage-subject';

export const theme$ = writableStringLocalStorageSubject()('theme', 'sage-green-theme');
export const obsidianVaultPath$ = writableStringLocalStorageSubject()('obsidianVaultPath', '');
export const aiProvider$ = writableStringLocalStorageSubject()('aiProvider', 'anthropic');
export const aiApiKey$ = writableStringLocalStorageSubject()('aiApiKey', '');
export const aiBaseUrl$ = writableStringLocalStorageSubject()('aiBaseUrl', '');
export const aiModel$ = writableStringLocalStorageSubject()('aiModel', 'claude-sonnet-4-6');
export const dictFolderPath$ = writableStringLocalStorageSubject()('dictFolderPath', '');
export const syncToken$ = writableStringLocalStorageSubject()('syncToken', '');
export const syncDeviceId$ = writableStringLocalStorageSubject()('syncDeviceId', '');
export const syncEnabled$ = writableBooleanLocalStorageSubject()('syncEnabled', false);
export const syncLastAt$ = writableNumberLocalStorageSubject()('syncLastAt', 0);
export const customThemes$ = writableObjectLocalStorageSubject<Record<string, ThemeOption>>()(
  'customThemes',
  {}
);

// Validate theme: if stored value is empty or not in available themes, reset to default
{
  const currentTheme = theme$.getValue();
  const availableThemeIds = new Set([
    'light-theme',
    'ecru-theme',
    'water-theme',
    'seafoam-theme',
    'columbia-theme',
    'dove-theme',
    'gray-theme',
    'dark-theme',
    'black-theme',
    'abyss-theme',
    'espresso-theme',
    'rainforest-theme',
    'sage-green-theme',
    ...Object.keys(customThemes$.getValue())
  ]);
  if (!currentTheme || !availableThemeIds.has(currentTheme)) {
    theme$.next('sage-green-theme');
  }
}
export const multiplier$ = writableNumberLocalStorageSubject()('autoScrollMultiplier', 6);

// Migrate legacy scroll-speed values (used to be 20 = scroll factor; now means chars/sec)
{
  const v = multiplier$.getValue();
  if (v > 30 || v < 1) multiplier$.next(6);
}
export const autoScrollStopAtChapter$ = writableBooleanLocalStorageSubject()(
  'autoScrollStopAtChapter',
  false
);

/** Absolute paths queued from file-association / CLI launch (desktop only). */
export const pendingLaunchFiles$ = writableSubject<string[]>([]);

/** Tray + window menu request to toggle TTS (emitted by both global shortcut and tray). */
export const ttsToggleRequest$ = writableSubject<number>(0);

/** Where to start when the user presses play. 'selection' = current
 * cursor/selection (falls back to resume); 'resume' = saved position only;
 * 'visible' = whatever the viewport shows. */
export const ttsStartStrategy$ = writableStringLocalStorageSubject()(
  'ttsStartStrategy',
  'selection'
);
/** When TTS finishes a section in paginated mode, auto-advance to next section. */
export const ttsAutoAdvanceSection$ = writableBooleanLocalStorageSubject()(
  'ttsAutoAdvanceSection',
  true
);

export const ttsShortcut$ = writableStringLocalStorageSubject()('ttsShortcut', 'ctrl+alt+p');

export const highlightSidebarOpen$ = writableBooleanLocalStorageSubject()('highlightSidebarOpen', false);

export const ttsEngine$ = writableStringLocalStorageSubject()('ttsEngine', 'web');
export const ttsSapiVoiceId$ = writableStringLocalStorageSubject()('ttsSapiVoiceId', '');

// User-configurable HTTP TTS
export const ttsCustomEndpoint$ = writableStringLocalStorageSubject()('ttsCustomEndpoint', '');
export const ttsCustomMethod$ = writableStringLocalStorageSubject()('ttsCustomMethod', 'POST');
/** JSON object of {Header: Value}. Stored as a string so users can free-edit. */
export const ttsCustomHeaders$ = writableStringLocalStorageSubject()(
  'ttsCustomHeaders',
  '{\n  "Content-Type": "application/json"\n}'
);
/** Body template; the literal {text} is replaced with the (JSON-escaped) sentence. */
export const ttsCustomBody$ = writableStringLocalStorageSubject()('ttsCustomBody', '');
/** Dot-path to base64 audio in a JSON response (e.g. choices.0.message.audio.data). Empty = raw audio bytes. */
export const ttsCustomAudioPath$ = writableStringLocalStorageSubject()('ttsCustomAudioPath', '');
/** Optional HTTP/SOCKS5 proxy for the TTS request (e.g. http://127.0.0.1:7890). Empty = no proxy. */
export const ttsCustomProxyUrl$ = writableStringLocalStorageSubject()('ttsCustomProxyUrl', '');

export interface TtsCustomPresetState {
  endpoint: string;
  method: string;
  headers: string;
  body: string;
  audioPath: string;
  proxyUrl: string;
}

/** Which named preset is currently active. The five ttsCustom* stores above
 * mirror the active preset's slot so existing readers (auto-reader-custom)
 * don't need to know about the map. */
export const ttsCustomActivePreset$ = writableStringLocalStorageSubject()(
  'ttsCustomActivePreset',
  'manual'
);

/** Per-preset persisted state, so switching between openai/mimo/... doesn't
 * stomp the key the user typed in for the previous one. */
export const ttsCustomPresetStates$ = writableObjectLocalStorageSubject<
  Record<string, TtsCustomPresetState>
>()('ttsCustomPresetStates', {});

export interface TtsPosition {
  section: number;
  para: number;
  offset: number;
  explored: number;
}

export const ttsPositions$ = writableObjectLocalStorageSubject<Record<string, TtsPosition>>()(
  'ttsPositions',
  {}
);

export const readerRate$ = writableNumberLocalStorageSubject()('readerRate', 1);
export const readerVoiceUri$ = writableStringLocalStorageSubject()('readerVoiceUri', '');
export const readerEnabled$ = writableBooleanLocalStorageSubject()('readerEnabled', false);
export const lastBookHasImages$ = writableBooleanLocalStorageSubject()(
  'lastBookHasImages',
  false
);
export const fontFamilyGroupOne$ = writableStringLocalStorageSubject()(
  'fontFamilyGroupOne',
  'Noto Sans SC'
);
export const fontFamilyGroupTwo$ = writableStringLocalStorageSubject()(
  'fontFamilyGroupTwo',
  'Noto Sans SC'
);

// One-shot migration: upgrade legacy upstream defaults to Noto Sans SC.
// These JP fonts were removed in our font-slim pass, so without migration the
// browser falls back to system serif (Songti).
{
  const legacyOne = ['Noto Serif JP', 'Noto Sans JP'];
  const legacyTwo = ['Noto Sans JP'];
  if (legacyOne.includes(fontFamilyGroupOne$.getValue())) {
    fontFamilyGroupOne$.next('Noto Sans SC');
  }
  if (legacyTwo.includes(fontFamilyGroupTwo$.getValue())) {
    fontFamilyGroupTwo$.next('Noto Sans SC');
  }
}
export const fontWeight$ = writableNumberOrNullLocalStorageSubject()('fontWeight', null);
export const fontSize$ = writableNumberLocalStorageSubject()('fontSize', 20);
export const lineHeight$ = writableNumberLocalStorageSubject()('lineHeight', 1.65);
export const textIndentation$ = writableNumberLocalStorageSubject()('textIndentation', 0);
export const textMarginValue$ = writableNumberLocalStorageSubject()('textMarginValue', 0);
export const hideSpoilerImage$ = writableBooleanLocalStorageSubject()('hideSpoilerImage', true);
export const hideSpoilerImageMode$ = writableStringLocalStorageSubject<BlurMode>()(
  'hideSpoilerImageMode',
  BlurMode.AFTER_TOC
);
export const hideFurigana$ = writableBooleanLocalStorageSubject()('hideFurigana', false);
export const furiganaStyle$ = writableStringLocalStorageSubject<FuriganaStyle>()(
  'furiganaStyle',
  FuriganaStyle.Partial
);
export const writingMode$ = writableStringLocalStorageSubject<WritingMode>()(
  'writingMode',
  'horizontal-tb'
);
export const enableVerticalFontKerning$ = writableBooleanLocalStorageSubject()(
  'enableVerticalFontKerning',
  false
);
export const enableFontVPAL$ = writableBooleanLocalStorageSubject()('enableFontVPAL', false);
export const verticalTextOrientation$ =
  writableStringLocalStorageSubject<VerticalTextOrientation>()('verticalTextOrientation', 'mixed');
export const prioritizeReaderStyles$ = writableBooleanLocalStorageSubject()(
  'prioritizeReaderStyles',
  false
);
export const enableTextJustification$ = writableBooleanLocalStorageSubject()(
  'enableTextJustification',
  false
);
export const enableTextWrapPretty$ = writableBooleanLocalStorageSubject()(
  'enableTextWrapPretty',
  false
);
export const textMarginMode$ = writableStringLocalStorageSubject<TextMarginMode>()(
  'textMarginMode',
  'auto'
);
export const enableReaderWakeLock$ = writableBooleanLocalStorageSubject()(
  'enableReaderWakeLock',
  false
);
export const verticalMode$ = writingMode$.pipe(map((writingMode) => writingMode === 'vertical-rl'));
export const showCharacterCounter$ = writableBooleanLocalStorageSubject()(
  'showCharacterCounter',
  true
);
export const showPercentage$ = writableBooleanLocalStorageSubject()('showPercentage', true);
export const showFooterChapterCharacterCounter$ = writableBooleanLocalStorageSubject()(
  'showFooterChapterCharacterCounter',
  false
);
export const showFooterChapterPercentage$ = writableBooleanLocalStorageSubject()(
  'showFooterChapterPercentage',
  false
);
export const viewMode$ = writableStringLocalStorageSubject<ViewMode>()(
  'viewMode',
  ViewMode.Continuous
);

// Validate viewMode: reset invalid values to Continuous
{
  const currentViewMode = viewMode$.getValue();
  if (!currentViewMode || !Object.values(ViewMode).includes(currentViewMode as ViewMode)) {
    viewMode$.next(ViewMode.Continuous);
  }
}

export const secondDimensionMaxValue$ = writableNumberLocalStorageSubject()(
  'secondDimensionMaxValue',
  0
);
export const firstDimensionMargin$ = writableNumberLocalStorageSubject()('firstDimensionMargin', 0);

export const swipeThreshold$ = writableNumberLocalStorageSubject()('swipeThreshold', 10);

export const disableWheelNavigation$ = writableBooleanLocalStorageSubject()(
  'disableWheelNavigation',
  false
);

export const autoPositionOnResize$ = writableBooleanLocalStorageSubject()(
  'autoPositionOnResize',
  true
);

export const avoidPageBreak$ = writableBooleanLocalStorageSubject()('avoidPageBreak', false);

export const pauseTrackerOnCustomPointChange$ = writableBooleanLocalStorageSubject()(
  'pauseTrackerOnCustomPointChange',
  true
);

export const customReadingPointEnabled$ = writableBooleanLocalStorageSubject()(
  'customReadingPointEnabled',
  false
);

export const selectionToBookmarkEnabled$ = writableBooleanLocalStorageSubject()(
  'selectionToBookmarkEnabled',
  false
);

export const enableTapEdgeToFlip$ = writableBooleanLocalStorageSubject()(
  'enableTapEdgeToFlip',
  false
);

export const confirmClose$ = writableBooleanLocalStorageSubject()('confirmClose', false);

export const manualBookmark$ = writableBooleanLocalStorageSubject()('manualBookmark', false);

export const autoBookmark$ = writableBooleanLocalStorageSubject()('autoBookmark', true);

export const autoBookmarkTime$ = writableNumberLocalStorageSubject()('autoBookmarkTime', 3);

export const pageColumns$ = writableNumberLocalStorageSubject()('pageColumns', 0);

export const requestPersistentStorage$ = writableBooleanLocalStorageSubject()(
  'requestPersistentStorage',
  true
);

export const hideExternalReadHint$ = writableBooleanLocalStorageSubject()(
  'hideExternalReadHint',
  false
);

export const pdfOcrPromptEnabled$ = writableBooleanLocalStorageSubject()(
  'pdfOcrPromptEnabled',
  true
);

export const pdfOcrSkippedBookIds$ = writableStringLocalStorageSubject()(
  'pdfOcrSkippedBookIds',
  ''
);

// Kokoro-82M offline TTS engine. The model is NOT downloaded until the
// user opts in via the settings UI; the accepted flag persists so they
// don't have to re-consent on every cold start.
export const kokoroAccepted$ = writableBooleanLocalStorageSubject()(
  'kokoroAccepted',
  false
);

/** Which Kokoro variant to load. v1.0 is English-only (28 voices). v1.1-zh
 *  from 2025-03 drops most v1.0 voices but adds 40+ Mandarin voices plus
 *  three new English speakers (Maple/Sol/Vale) — the pick for Chinese
 *  audiobook use. Default is v1.1-zh: the reader is Chinese-first and the
 *  v1.0 English voices it drops aren't the ones users typically pick anyway.
 *  Swapping the id invalidates the current voice, so the settings UI must
 *  clamp `kokoroVoiceId$` into the new list. */
export type KokoroModelId = 'v1.0' | 'v1.1-zh';
export const kokoroModel$ = writableStringLocalStorageSubject<KokoroModelId>()(
  'kokoroModel',
  'v1.1-zh'
);
export const KOKORO_MODEL_REPOS: Record<KokoroModelId, string> = {
  'v1.0': 'onnx-community/Kokoro-82M-v1.0-ONNX',
  'v1.1-zh': 'onnx-community/Kokoro-82M-v1.1-zh-ONNX'
};
// Default voice per model. v1.1-zh drops af_heart, so the default there is
// the leading Chinese female voice from that build.
export const kokoroVoiceId$ = writableStringLocalStorageSubject()(
  'kokoroVoiceId',
  'zf_001'
);

export interface KokoroLoadStatus {
  phase: 'idle' | 'loading' | 'ready' | 'errored';
  message: string;
  loaded: number;
  total: number;
}
export const kokoroLoadStatus$ = writableSubject<KokoroLoadStatus>({
  phase: 'idle',
  message: '',
  loaded: 0,
  total: 0
});

// Library cover card min-width in px. Grid uses repeat(auto-fill, minmax(..., 1fr))
// so smaller value = denser library (more columns at the same window width).
export const bookCoverMinWidth$ = writableNumberLocalStorageSubject()(
  'bookCoverMinWidth',
  170
);

// Library filter — applied AFTER the folder filter, before sort.
// Empty formats[] means "all formats"; completion 'all' means no filter.
// Persisted via localStorage so the user's filter survives reloads.
export type LibraryCompletion = 'all' | 'unread' | 'reading' | 'done';
export interface LibraryFilter {
  formats: string[];
  completion: LibraryCompletion;
}
const _libFilterRaw$ = writableStringLocalStorageSubject()('libraryFilter', '');
export const libraryFilter$ = writableSubject<LibraryFilter>({
  formats: [],
  completion: 'all'
});
if (typeof window !== 'undefined') {
  const initial = _libFilterRaw$.getValue();
  if (initial) {
    try {
      const parsed = JSON.parse(initial);
      if (parsed && typeof parsed === 'object') {
        libraryFilter$.next({
          formats: Array.isArray(parsed.formats) ? parsed.formats : [],
          completion: ['all', 'unread', 'reading', 'done'].includes(parsed.completion)
            ? parsed.completion
            : 'all'
        });
      }
    } catch {
      /* corrupt entry — fall back to default */
    }
  }
  libraryFilter$.subscribe((v) => _libFilterRaw$.next(JSON.stringify(v)));
}

export const importHTMLFixMode$ = writableStringLocalStorageSubject<ImportHTMLFixMode>()(
  'importHTMLFixMode',
  ImportHTMLFixMode.OFF
);

export const restrictImportFixToAnchor$ = writableBooleanLocalStorageSubject()(
  'restrictImportFixToAnchor',
  true
);

export const cacheStorageData$ = writableBooleanLocalStorageSubject()('cacheStorageData', false);

export const autoReplication$ = writableStringLocalStorageSubject<AutoReplicationType>()(
  'autoReplication',
  AutoReplicationType.Off
);

export const replicationSaveBehavior$ =
  writableStringLocalStorageSubject<ReplicationSaveBehavior>()(
    'replicationSaveBehavior',
    ReplicationSaveBehavior.NewOnly
  );

export const showExternalPlaceholder$ = writableBooleanLocalStorageSubject()(
  'showExternalPlaceholder',
  false
);


/**
 * User-chosen absolute path for the on-disk library folder used by
 * TauriFsStorageHandler. Empty string = fall back to Documents/AutoBook
 * (BaseDirectory.Document + "AutoBook").
 */
export const fsRoot$ = writableStringLocalStorageSubject()('fsRoot', '');

export const keepLocalStatisticsOnDeletion$ = writableBooleanLocalStorageSubject()(
  'keepLocalStatisticsOnDeletion',
  true
);

export const overwriteBookCompletion$ = writableBooleanLocalStorageSubject()(
  'overwriteBookCompletion',
  false
);

export const startDayHoursForTracker$ = writableNumberLocalStorageSubject()(
  'startDayHoursForTracker',
  0
);

export const statisticsEnabled$ = writableBooleanLocalStorageSubject()('statisticsEnabled', false);

export const statisticsMergeMode$ = writableStringLocalStorageSubject<MergeMode>()(
  'statisticsMergeMode',
  MergeMode.MERGE
);

export const readingGoalsMergeMode$ = writableStringLocalStorageSubject<MergeMode>()(
  'readingGoalsMergeMode',
  MergeMode.MERGE
);

export const trackerAutoPause$ = writableStringLocalStorageSubject<TrackerAutoPause>()(
  'trackerAutoPause',
  TrackerAutoPause.MODERATE
);

export const openTrackerOnCompletion$ = writableBooleanLocalStorageSubject()(
  'openTrackerOnCompletion',
  true
);

export const addCharactersOnCompletion$ = writableBooleanLocalStorageSubject()(
  'addCharactersOnCompletion',
  false
);

export const trackerAutostartTime$ = writableNumberLocalStorageSubject()('trackerAutoStartTime', 0);

export const trackerIdleTime$ = writableNumberLocalStorageSubject()('trackerIdleTime', 0);

export const trackerForwardSkipThreshold$ = writableNumberLocalStorageSubject()(
  'trackerForwardSkipThreshold',
  2700
);

export const trackerBackwardSkipThreshold$ = writableNumberLocalStorageSubject()(
  'trackerBackwardSkipThreshold',
  2700
);

export const trackerSkipThresholdAction$ =
  writableStringLocalStorageSubject<TrackerSkipThresholdAction>()(
    'trackerSkipThresholdAction',
    TrackerSkipThresholdAction.IGNORE
  );

export const trackerPopupDetection$ = writableBooleanLocalStorageSubject()(
  'trackerPopupDetection',
  false
);

export const adjustStatisticsAfterIdleTime$ = writableBooleanLocalStorageSubject()(
  'adjustStatisticsAfterIdleTime',
  true
);

export const readingGoal$ = writableObjectLocalStorageSubject<ReadingGoal>()('readingGoal', {
  timeGoal: 0,
  characterGoal: 0,
  goalFrequency: ReadingGoalFrequency.DAILY,
  goalStartDate: '',
  lastGoalModified: Date.now()
});

export const lastExportedTarget$ = writableStringLocalStorageSubject<StorageKey>()(
  'lastExportedTarget',
  StorageKey.BACKUP
);

export const lastExportedTypes$ = writableArrayLocalStorageSubject<StorageDataType>()(
  'lastExportedTypes',
  [StorageDataType.PROGRESS, StorageDataType.STATISTICS]
);

export const lastBlurredTrackerItems$ = writableSetLocalStorageSubject<string>()(
  'lastBlurredTrackerItems',
  new Set<string>()
);

export const lastSyncedSettingsSource$ = writableStringLocalStorageSubject()(
  'lastSyncedSettingsSource',
  InternalStorageSources.INTERNAL_BROWSER
);

export const lastSyncedSettingsTarget$ = writableStringLocalStorageSubject()(
  'lastSyncedSettingsTarget',
  InternalStorageSources.INTERNAL_ZIP
);

export const lastReadingGoalsModified$ = writableNumberLocalStorageSubject()(
  'lastReadingGoalsModified',
  0
);

export const lastStatisticsTab$ = writableStringLocalStorageSubject<StatisticsTab>()(
  'lastStatisticsTab',
  StatisticsTab.MAIN
);
// Auto-heal legacy values: 1.20.0 removed the OVERVIEW (日历) tab.
// Users upgrading with that value stored would land on an empty view.
if (typeof window !== 'undefined') {
  const valid = new Set<string>(Object.values(StatisticsTab));
  if (!valid.has(lastStatisticsTab$.getValue())) {
    lastStatisticsTab$.next(StatisticsTab.MAIN);
  }
}

export const lastStatisticsRangeTemplate$ =
  writableStringLocalStorageSubject<StatisticsRangeTemplate>()(
    'lastStatisticsRangeTemplate',
    StatisticsRangeTemplate.TODAY
  );

export const lastStatisticsStartDate$ = writableStringLocalStorageSubject()(
  'lastStatisticsStartDate',
  ''
);

export const lastStatisticsEndDate$ = writableStringLocalStorageSubject()(
  'lastStatisticsEndDate',
  ''
);

export const lastStartDayOfWeek$ = writableNumberLocalStorageSubject()('lastStartDayOfWeek', 1);

export const lastReadingTimeDataSource$ = writableStringLocalStorageSubject<keyof BookStatistic>()(
  'lastReadingTimeDataSource',
  'readingTime'
);

export const lastCharactersDataSource$ = writableStringLocalStorageSubject<keyof BookStatistic>()(
  'lastCharactersDataSource',
  'charactersRead'
);

export const lastReadingSpeedDataSource$ = writableStringLocalStorageSubject<keyof BookStatistic>()(
  'lastReadingSpeedDataSource',
  'lastReadingSpeed'
);

export const lastPrimaryReadingDataAggregationMode$ =
  writableStringLocalStorageSubject<StatisticsReadingDataAggregationMode>()(
    'lastPrimaryReadingDataAggregationMode',
    StatisticsReadingDataAggregationMode.NONE
  );

export const confirmStatisticsDeletion$ = writableBooleanLocalStorageSubject()(
  'confirmStatisticsDeletion',
  true
);

export const lastStatisticsFilterDateRangeOnly$ = writableBooleanLocalStorageSubject()(
  'lastStatisticsFilterDateRangeOnly',
  false
);

export const lastStatisticsFilterShowSelectedTitlesOnly$ = writableBooleanLocalStorageSubject()(
  'lastStatisticsFilterShowSelectedTitlesOnly',
  false
);

export const lastStatisticsSummarySortProperty$ = writableStringLocalStorageSubject<
  keyof BookStatistic
>()('lastStatisticsSummarySortProperty', 'readingTime');

export const lastStatisticsSummarySortDirection$ =
  writableStringLocalStorageSubject<SortDirection>()(
    'lastStatisticsSummarySortDirection',
    SortDirection.DESC
  );

export const fileCountData$ = writableSubject<Record<string, number> | undefined>(undefined);

export const bookReaderKeybindMap$ = writableSubject<BookReaderKeybindMap>({
  KeyB: BookReaderAvailableKeybind.BOOKMARK,
  b: BookReaderAvailableKeybind.BOOKMARK,
  KeyR: BookReaderAvailableKeybind.JUMP_TO_BOOKMARK,
  r: BookReaderAvailableKeybind.JUMP_TO_BOOKMARK,
  PageDown: BookReaderAvailableKeybind.NEXT_PAGE,
  pagedown: BookReaderAvailableKeybind.NEXT_PAGE,
  PageUp: BookReaderAvailableKeybind.PREV_PAGE,
  pageup: BookReaderAvailableKeybind.PREV_PAGE,
  Space: BookReaderAvailableKeybind.AUTO_SCROLL_TOGGLE,
  ' ': BookReaderAvailableKeybind.AUTO_SCROLL_TOGGLE,
  KeyA: BookReaderAvailableKeybind.AUTO_SCROLL_INCREASE,
  a: BookReaderAvailableKeybind.AUTO_SCROLL_INCREASE,
  KeyD: BookReaderAvailableKeybind.AUTO_SCROLL_DECREASE,
  d: BookReaderAvailableKeybind.AUTO_SCROLL_DECREASE,
  KeyV: BookReaderAvailableKeybind.AUTO_READER_TOGGLE,
  v: BookReaderAvailableKeybind.AUTO_READER_TOGGLE,
  KeyN: BookReaderAvailableKeybind.PREV_CHAPTER,
  n: BookReaderAvailableKeybind.PREV_CHAPTER,
  KeyM: BookReaderAvailableKeybind.NEXT_CHAPTER,
  m: BookReaderAvailableKeybind.NEXT_CHAPTER,
  KeyT: BookReaderAvailableKeybind.SET_READING_POINT,
  t: BookReaderAvailableKeybind.SET_READING_POINT,
  KeyP: BookReaderAvailableKeybind.TOGGLE_TRACKING,
  p: BookReaderAvailableKeybind.TOGGLE_TRACKING,
  KeyF: BookReaderAvailableKeybind.TOGGLE_TRACKING_FREEZE,
  f: BookReaderAvailableKeybind.TOGGLE_TRACKING_FREEZE
});

export const statisticsTabKeybindMap$ = writableSubject<StatisticsTabKeybindMap>({
  KeyT: StatisticsTabAvailableKeybind.RANGE_TEMPLATE_TOGGLE,
  t: StatisticsTabAvailableKeybind.RANGE_TEMPLATE_TOGGLE,
  KeyA: StatisticsTabAvailableKeybind.AGGREGRATION_TOGGLE,
  a: StatisticsTabAvailableKeybind.AGGREGRATION_TOGGLE
});

export const readerImageGalleryKeybindMap$ = writableSubject<ReaderImageGalleryKeybindMap>({
  PageDown: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  pagedown: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  ArrowDown: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  arrowdown: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  ArrowRight: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  arrowright: ReaderImageGalleryAvailableKeybind.NEXT_IMAGE,
  ArrowUp: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  arrowup: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  ArrowLeft: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  arrowleft: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  PageUp: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  pageup: ReaderImageGalleryAvailableKeybind.PREVIOUS_IMAGE,
  Escape: ReaderImageGalleryAvailableKeybind.CLOSE,
  escape: ReaderImageGalleryAvailableKeybind.CLOSE
});

const db = browser ? createBooksDb() : import('fake-indexeddb/auto').then(() => createBooksDb());

export const database = new DatabaseService(db);

export const domainHintSeen$ = writableBooleanLocalStorageSubject()('domainHintSeen', false);

const defaultBooklistSortOptions: Record<string, SortOption> = {
  [StorageKey.BROWSER]: { property: 'lastBookOpen', direction: SortDirection.DESC },
  [StorageKey.TAURI_FS]: { property: 'lastBookOpen', direction: SortDirection.DESC }
};

export const booklistSortOptions$ = writableObjectLocalStorageSubject<Record<string, SortOption>>()(
  'booklistSortOptions',
  defaultBooklistSortOptions
);

// Migration: backfill missing StorageKey entries (e.g. TAURI_FS added after first launch)
{
  const current = booklistSortOptions$.getValue();
  let needsUpdate = false;
  for (const [key, value] of Object.entries(defaultBooklistSortOptions)) {
    if (!current[key]) {
      current[key] = value;
      needsUpdate = true;
    }
  }
  if (needsUpdate) booklistSortOptions$.next({ ...current });
}

export const verticalCustomReadingPosition$ = writableNumberLocalStorageSubject()(
  'verticalCustomReadingPosition',
  100
);

export const horizontalCustomReadingPosition$ = writableNumberLocalStorageSubject()(
  'horizontalCustomReadingPosition',
  0
);

export const isOnline$ = writableSubject<boolean>(true);

export const skipKeyDownListener$ = writableSubject<boolean>(false);

export const userFonts$ = writableArrayLocalStorageSubject<UserFont>()('userfonts', []);

// --- Dev-only console handle. Run `npm run dev` and inspect
// `window.__autobook.database.bookmarks$.subscribe(b => console.log(b))`
// to watch bookmarks observable updates live. Stripped in prod builds. ---
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__autobook = {
    database,
    bookmarksChanged$: undefined as any, // populated below once available
    stores: {
      ttsPositions$,
      bookReaderKeybindMap$,
      lastItem$: database.lastItem$
    }
  };
  // database isn't a circular ref problem because we just exposed it above.
  (window as any).__autobook.bookmarksChanged$ = database.bookmarksChanged$;
}
