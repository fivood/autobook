/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbHighlight,
  BooksDbHighlightFolder,
  BooksDbBookMetadata,
  BooksDbManualBook,
  BooksDbReadingGoal,
  BooksDbSession,
  BooksDbStatistic,
  BooksDbSubtitleData
} from '$lib/data/database/books-db/versions/books-db';
import { Observable, Subject, from } from 'rxjs';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  advanceDateDays,
  getDate,
  getDateKey,
  mergeStatistics,
  updateStatisticToStore
} from '$lib/functions/statistic-util';
import { catchError, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import {
  getCurrentReadingGoal,
  mergeReadingGoals,
  readingGoalSortFunction
} from '$lib/data/reading-goal';
import { lastReadingGoalsModified$, readingGoal$ } from '$lib/data/store';

import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BookStatistic } from '$lib/components/statistics/statistics-types';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';
import type { IDBPDatabase } from 'idb';
import LogReportDialog from '$lib/components/log-report-dialog.svelte';
import { MergeMode } from '$lib/data/merge-mode';
import { HighlightRepository } from './highlight-repository';
import { normalizeHighlightSlot } from '$lib/data/highlight-color';
import MessageDialog from '$lib/components/message-dialog.svelte';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { dialogManager } from '$lib/data/dialog-manager';
import { getDefaultStatistic } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { iffBrowser } from '$lib/functions/rxjs/iff-browser';
import { logger } from '$lib/data/logger';
import pLimit from 'p-limit';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { throwIfAborted } from '$lib/functions/replication/replication-error';

const LAST_ITEM_KEY = 0;

export class DatabaseService {
  private db$: Observable<Awaited<typeof this.db>>;

  isReady$: Observable<boolean>;

  listLoading$ = new Subject<boolean>();

  dataListChanged$ = new Subject<BaseStorageHandler | undefined>();

  lastHandler: BaseStorageHandler | undefined;

  dataList$ = iffBrowser(() =>
    this.dataListChanged$.pipe(
      startWith(undefined),
      tap((handler) => {
        this.lastHandler = handler;
      }),
      switchMap(() => storageSource$),
      switchMap((storageSource) =>
        from(
          Promise.resolve(this.lastHandler || getStorageHandler(window, storageSource, '')).then(
            (handler) => {
              logger.clearHistory();

              return handler.getBookList();
            }
          )
        ).pipe(
          catchError((error: unknown) => {
            if (error instanceof Error) {
              const showReport = logger.errorCount > 1;

              logger.warn(error.message);

              dialogManager.dialogs$.next([
                {
                  component: showReport ? LogReportDialog : MessageDialog,
                  props: {
                    title: '失败',
                    message: showReport ? '发生错误' : `发生错误: ${error.message}`
                  }
                }
              ]);
            }

            if (storageSource !== StorageKey.BROWSER) {
              this.lastHandler = undefined;
              storageSource$.next(StorageKey.BROWSER);
            }

            return [[]];
          })
        )
      ),
      tap(() => {
        this.lastHandler = undefined;
        this.listLoading$.next(false);
      }),
      shareReplay({ refCount: true, bufferSize: 1 })
    )
  );

  highlightsChanged$ = new Subject<void>();

  private highlightRepo!: HighlightRepository;

  /** Fires whenever storeStatistics finishes, so cross-device sync can push. */
  statisticsChanged$ = new Subject<void>();

  /** Fires after appendSession succeeds, so the year tab knows to refresh. */
  sessionsChanged$ = new Subject<void>();

  manualBooksChanged$ = new Subject<void>();

  bookMetadataChanged$ = new Subject<void>();

  bookmarksChanged$ = new Subject<void>();

  bookmarks$ = this.bookmarksChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.getAll('bookmark')),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  lastItemChanged$ = new Subject<void>();

  lastItem$ = this.lastItemChanged$.pipe(
    startWith(0),
    switchMap(() => this.db$),
    switchMap((db) => db.get('lastItem', LAST_ITEM_KEY)),
    shareReplay({ refCount: true, bufferSize: 1 })
  );

  constructor(public db: Promise<IDBPDatabase<BooksDb>>) {
    this.db$ = from(db).pipe(shareReplay({ refCount: true, bufferSize: 1 }));
    this.isReady$ = this.db$.pipe(map((x) => !!x));
    this.highlightRepo = new HighlightRepository(db, this.highlightsChanged$);
  }

  async getLastModifiedForType(title: string, dataType: string) {
    const db = await this.db;
    const result = await db.get('lastModified', [title, dataType]);

    return result?.lastModifiedValue || 0;
  }

  async getData(dataId: number) {
    if (!Number.isNaN(dataId)) {
      const db = await this.db;
      return db.get('data', dataId);
    }
    return undefined;
  }

  async getDataByTitle(title: string) {
    if (title) {
      const db = await this.db;
      return db.getFromIndex('data', 'title', title);
    }

    return undefined;
  }

  async setFirstBookRead(
    bookTitle: string,
    startDaysHoursForTracker: number,
    existingStatistic?: BooksDbStatistic
  ) {
    const db = await this.db;

    let firstStatistic = existingStatistic;

    if (!firstStatistic) {
      firstStatistic = await db.get('statistic', IDBKeyRange.bound([bookTitle], [bookTitle, []]));
    }

    if (firstStatistic) {
      return [firstStatistic.dateKey, false];
    }

    const dateKey = getDateKey(startDaysHoursForTracker);
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const newStatistic = getDefaultStatistic(bookTitle, dateKey);

      await statisticsStore.put(newStatistic);
      await lastModifiedStore.put({
        title: bookTitle,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: newStatistic.lastStatisticModified
      });

      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }

    return [dateKey, true];
  }

  async upsertData(
    data: Omit<BooksDbBookData, 'id'>,
    saveBehavior: ReplicationSaveBehavior,
    skipTimestampFallback = true,
    removeStorageContext = true
  ) {
    const db = await this.db;

    let dataId: number;
    let bookData: BooksDbBookData;

    const tx = db.transaction('data', 'readwrite');
    const { store } = tx;
    const oldData = await store.index('title').get(data.title);

    if (oldData) {
      if (removeStorageContext) {
        oldData.storageSource = undefined;
      }

      if (
        saveBehavior === ReplicationSaveBehavior.NewOnly &&
        oldData.lastBookModified &&
        data.lastBookModified &&
        oldData.lastBookModified >= data.lastBookModified &&
        (oldData.lastBookOpen || 0) >= (data.lastBookOpen || 0)
      ) {
        bookData = oldData;
        dataId = oldData.id;
      } else {
        bookData = {
          ...data,
          id: oldData.id,
          ...(skipTimestampFallback
            ? { lastBookModified: data.lastBookModified, lastBookOpen: data.lastBookOpen }
            : {
                lastBookModified: data.lastBookModified || oldData.lastBookModified,
                lastBookOpen: data.lastBookOpen || oldData.lastBookOpen
              }),
          ...(removeStorageContext ? { storageSource: undefined } : {})
        };
        dataId = await store.put(bookData);
      }
    } else {
      // Until https://github.com/jakearchibald/idb/issues/150 resolves
      const bookDataWithoutKey: Omit<BooksDbBookData, 'id'> = data;
      dataId = await store.add(bookDataWithoutKey as BooksDbBookData);
      bookData = { ...data, id: dataId };
    }
    await tx.done;

    return bookData;
  }

  async deleteData(
    dataIds: number[],
    idsToTitles: Map<number, string>,
    cancelSignal: AbortSignal,
    keepLocalStatistics: boolean
  ) {
    const db = await this.db;
    const lastItemObj = await db.get('lastItem', LAST_ITEM_KEY);
    const bookmarkIdData = await db.getAllKeys('bookmark');
    const lastItem = lastItemObj?.dataId;
    const bookmarkIds = new Set(bookmarkIdData);
    const deleted: number[] = [];
    const limiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    let errorMessage = '';

    replicationProgress$.next({ progressBase: 1, maxProgress: dataIds.length });

    dataIds.forEach((id) =>
      tasks.push(
        limiter(async () => {
          try {
            throwIfAborted(cancelSignal);

            deleted.push(
              await this.deleteSingleData(
                db,
                id,
                idsToTitles.get(id),
                { lastItem, bookmarkIds },
                !keepLocalStatistics
              )
            );
          } catch (error) {
            errorMessage = handleErrorDuringReplication(
              error,
              `Error deleting Book with id ${id}: `,
              [limiter]
            );
          }
        })
      )
    );

    await Promise.all(tasks).catch(() => {});

    return { error: errorMessage, deleted };
  }

  async getBookmark(dataId: number) {
    const db = await this.db;
    return db.get('bookmark', dataId);
  }

  async putBookmark(bookmarkData: BooksDbBookmarkData) {
    const db = await this.db;

    const result = await db.put('bookmark', bookmarkData);
    // bookmarks$ feeds library hover popovers and the progress bar on
    // book cards; without this nudge they keep showing the stale
    // app-start snapshot and never reflect new reading progress.
    this.bookmarksChanged$.next();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[autobook:dbg] putBookmark', {
        dataId: bookmarkData.dataId,
        progress: bookmarkData.progress,
        exploredCharCount: bookmarkData.exploredCharCount,
        lastBookmarkModified: bookmarkData.lastBookmarkModified
      });
    }
    return result;
  }

  async putAudioBook(audioBook: BooksDbAudioBook) {
    const db = await this.db;

    return db.put('audioBook', audioBook);
  }

  async putSubtitleData(subtitleData: BooksDbSubtitleData) {
    const db = await this.db;

    return db.put('subtitle', subtitleData);
  }

  async putLastItem(dataId: number) {
    const db = await this.db;
    const result = await db.put('lastItem', { dataId }, LAST_ITEM_KEY);
    this.lastItemChanged$.next();
    return result;
  }

  async deleteLastItem() {
    const db = await this.db;
    await db.delete('lastItem', LAST_ITEM_KEY);
    this.lastItemChanged$.next();
  }

  private async deleteSingleData(
    db: IDBPDatabase<BooksDb>,
    dataId: number,
    title: string | undefined,
    cachedData: { bookmarkIds: Set<number>; lastItem: number | undefined },
    shouldDeleteStatistics: boolean
  ) {
    const storeNames: (
      | 'data'
      | 'bookmark'
      | 'statistic'
      | 'lastItem'
      | 'lastModified'
      | 'audioBook'
      | 'subtitle'
      | 'handle'
    )[] = ['data', 'audioBook', 'subtitle', 'handle'];
    const shouldDeleteLastItem = cachedData.lastItem === dataId;
    const shouldDeleteBookmark = cachedData.bookmarkIds.has(dataId);

    let bookTitle = title;

    if (shouldDeleteLastItem) {
      storeNames.push('lastItem');
    }

    if (shouldDeleteBookmark) {
      storeNames.push('bookmark');
    }

    if (shouldDeleteStatistics) {
      storeNames.push('statistic');
      storeNames.push('lastModified');
    }

    const tx = db.transaction(storeNames, 'readwrite');

    try {
      if (!bookTitle) {
        bookTitle = (await tx.objectStore('data').get(dataId))?.title;
      }

      if (shouldDeleteLastItem) {
        await tx.objectStore('lastItem').delete(LAST_ITEM_KEY);
      }

      if (shouldDeleteBookmark) {
        await tx.objectStore('bookmark').delete(dataId);
      }

      if (shouldDeleteStatistics && bookTitle) {
        await tx.objectStore('statistic').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
        await tx.objectStore('lastModified').delete([bookTitle, StorageDataType.STATISTICS]);
      }

      if (bookTitle) {
        await tx.objectStore('audioBook').delete(bookTitle);
        await tx.objectStore('subtitle').delete(bookTitle);
        await tx.objectStore('handle').delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
      }

      await tx.objectStore('data').delete(dataId);
      await tx.done;

      if (shouldDeleteLastItem) {
        this.lastItemChanged$.next();
      }
      if (shouldDeleteBookmark) {
        this.bookmarksChanged$.next();
      }
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }

    replicationProgress$.next({ progressToAdd: 1 });

    return dataId;
  }

  async getHighlights(dataId: number): Promise<BooksDbHighlight[]> {
    return this.highlightRepo.getHighlights(dataId);
  }

  async getAllHighlights(): Promise<BooksDbHighlight[]> {
    return this.highlightRepo.getAllHighlights();
  }

  async getHighlightsForTitle(title: string): Promise<BooksDbHighlight[]> {
    return this.highlightRepo.getHighlightsForTitle(title);
  }

  async storeHighlightsForTitle(
    title: string,
    incoming: BooksDbHighlight[],
    saveBehavior: ReplicationSaveBehavior
  ): Promise<void> {
    if (!incoming.length) return;
    const db = await this.db;
    const dataByTitle = await this.getDataByTitle(title);
    const resolvedDataId = dataByTitle?.id ?? -1;
    const existing = await this.getHighlightsForTitle(title);
    const existingByKey = new Map<string, BooksDbHighlight>();
    for (const h of existing) {
      existingByKey.set(`${h.startOffset}_${h.endOffset}_${h.text}`, h);
    }
    const tx = db.transaction('highlight', 'readwrite');
    for (const raw of incoming) {
      const key = `${raw.startOffset}_${raw.endOffset}_${raw.text}`;
      const prior = existingByKey.get(key);
      const merged: BooksDbHighlight = {
        ...raw,
        bookTitle: title,
        dataId: resolvedDataId,
        // Backups written before db v13 spell the slot as a colour name.
        color: normalizeHighlightSlot(raw.color)
      };
      if (prior) {
        if (
          saveBehavior === ReplicationSaveBehavior.NewOnly &&
          (prior.lastModified || 0) >= (raw.lastModified || 0)
        ) {
          continue;
        }
        merged.id = prior.id;
        await tx.store.put(merged);
      } else {
        const { id: _ignoredId, ...rest } = merged;
        await tx.store.add(rest as BooksDbHighlight);
      }
    }
    await tx.done;
    this.highlightsChanged$.next();
  }

  async putHighlight(highlight: BooksDbHighlight): Promise<number> {
    return this.highlightRepo.putHighlight(highlight);
  }

  async addHighlight(highlight: Omit<BooksDbHighlight, 'id'>): Promise<number> {
    return this.highlightRepo.addHighlight(highlight);
  }

  async deleteHighlight(id: number): Promise<void> {
    return this.highlightRepo.deleteHighlight(id);
  }

  async getHighlightFolders(): Promise<BooksDbHighlightFolder[]> {
    return this.highlightRepo.getHighlightFolders();
  }

  async addHighlightFolder(name: string, parentId?: number): Promise<number> {
    return this.highlightRepo.addHighlightFolder(name, parentId);
  }

  async renameHighlightFolder(id: number, name: string): Promise<void> {
    return this.highlightRepo.renameHighlightFolder(id, name);
  }

  async deleteHighlightFolder(id: number): Promise<void> {
    return this.highlightRepo.deleteHighlightFolder(id);
  }

  async setHighlightFolder(highlightId: number, folderId: number | undefined): Promise<void> {
    return this.highlightRepo.setHighlightFolder(highlightId, folderId);
  }

  async linkHighlights(aId: number, bId: number): Promise<void> {
    return this.highlightRepo.linkHighlights(aId, bId);
  }

  async unlinkHighlights(aId: number, bId: number): Promise<void> {
    return this.highlightRepo.unlinkHighlights(aId, bId);
  }

  async markHighlightReviewed(id: number): Promise<void> {
    return this.highlightRepo.markHighlightReviewed(id);
  }

  async getStatisticsForBook(bookTitle: string) {
    const db = await this.db;

    return db.getAll('statistic', IDBKeyRange.bound([bookTitle], [bookTitle, []]));
  }

  async getStatisticForCompletedBook(bookTitle: string) {
    const db = await this.db;

    return db.getFromIndex('statistic', 'completedBook', [1, bookTitle]);
  }

  async getStatisticsForTimeWindow(startDate: string, endDate: string) {
    const db = await this.db;

    return db.getAllFromIndex('statistic', 'dateKey', IDBKeyRange.bound(startDate, endDate));
  }

  /**
   * Persist a completed reading session. The tracker calls this when it flushes
   * a buffered stretch — commit is best-effort: we don't want a transient DB
   * hiccup to interrupt reading, so callers should catch and log.
   */
  async appendSession(session: Omit<BooksDbSession, 'id'>) {
    const db = await this.db;
    const id = await db.add('session', session as BooksDbSession);
    this.sessionsChanged$.next();
    return id;
  }

  async getSessionsForRange(startDateKey: string, endDateKey: string) {
    const db = await this.db;
    return db.getAllFromIndex(
      'session',
      'dateKey',
      IDBKeyRange.bound(startDateKey, endDateKey)
    );
  }

  async getAllSessions() {
    const db = await this.db;
    return db.getAll('session');
  }

  // ── manualBook (v11): metadata for manually-entered books ────────────
  //
  // Keyed by `title` — same key space as `statistic.title`, so upsert /
  // lookup is a single get on the title string. Cover images are stored
  // as raw Blobs; callers should `URL.createObjectURL` for display and
  // revoke on unmount.

  async getManualBook(title: string) {
    const db = await this.db;
    return db.get('manualBook', title);
  }

  async getAllManualBooks() {
    const db = await this.db;
    return db.getAll('manualBook');
  }

  async upsertManualBook(entry: Omit<BooksDbManualBook, 'createdAt' | 'updatedAt'>) {
    const db = await this.db;
    const now = Date.now();
    const existing = await db.get('manualBook', entry.title);
    const row: BooksDbManualBook = {
      ...(existing ?? {}),
      ...entry,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await db.put('manualBook', row);
    this.manualBooksChanged$.next();
    return row;
  }

  async deleteManualBook(title: string) {
    const db = await this.db;
    await db.delete('manualBook', title);
    this.manualBooksChanged$.next();
  }

  // ── bookMetadata (v12): bibliographic data parsed out of imported files ──
  //
  // Same `title` key space as manualBook, but never written by the user —
  // see the v12 schema comment for why the two stay separate stores.

  async getBookMetadata(title: string) {
    const db = await this.db;
    return db.get('bookMetadata', title);
  }

  async getAllBookMetadata() {
    const db = await this.db;
    return db.getAll('bookMetadata');
  }

  /**
   * Field-level merge: a re-import of a file that dropped a field must not
   * erase what an earlier import found. Only keys actually present in
   * `entry` overwrite; `undefined` means "this file didn't say", not "clear".
   */
  async putBookMetadata(entry: Omit<BooksDbBookMetadata, 'importedAt'>) {
    const db = await this.db;
    const existing = await db.get('bookMetadata', entry.title);
    const merged: BooksDbBookMetadata = {
      ...(existing ?? { title: entry.title }),
      importedAt: Date.now()
    };
    // Cast because a keyed write can't be proven type-safe field-by-field
    // here; the keys come from `entry`, which is the same interface minus
    // `importedAt`, so the shape is correct by construction.
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined && value !== '') {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    await db.put('bookMetadata', merged);
    this.bookMetadataChanged$.next();
    return merged;
  }

  async getStatisticsUntilDate(bookTitle: string, maxDate: string) {
    const db = await this.db;

    const results = await db.getAllFromIndex(
      'statistic',
      'dateKey',
      IDBKeyRange.upperBound(maxDate)
    );

    return results.filter((result) => result.title === bookTitle);
  }

  async storeStatistics(
    bookTitle: string,
    statistics: BooksDbStatistic[],
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    currentLastModified = Date.now()
  ) {
    const db = await this.db;

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = currentLastModified;

    if (statisticsMergeMode === MergeMode.MERGE) {
      const existingStatistics = await this.getStatisticsForBook(bookTitle);

      statisticsToStore = mergeStatistics(
        statistics,
        existingStatistics,
        saveBehavior === ReplicationSaveBehavior.NewOnly
      );
    }

    ({ newStatisticModified, statisticsToStore } = updateStatisticToStore(
      statisticsToStore,
      newStatisticModified
    ));

    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      if (statisticsMergeMode !== MergeMode.LOCAL) {
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.delete(IDBKeyRange.bound([bookTitle], [bookTitle, []]));
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        );
      }

      statisticsToStore.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              await statisticsStore.put(statistic);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      tasks.push(
        limiter(async () => {
          try {
            await lastModifiedStore.put({
              title: bookTitle,
              dataType: StorageDataType.STATISTICS,
              lastModifiedValue: newStatisticModified
            });
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      await Promise.all(tasks);
      await tx.done;
      this.statisticsChanged$.next();
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async updateStatistic(newStatistic: BookStatistic) {
    const db = await this.db;

    let existingStatistic = await db.get('statistic', [newStatistic.title, newStatistic.dateKey]);

    if (!existingStatistic) {
      throw new Error('无法在数据库中找到记录');
    }

    existingStatistic = {
      ...existingStatistic,
      charactersRead: newStatistic.charactersRead,
      readingTime: newStatistic.readingTime,
      minReadingSpeed: newStatistic.minReadingSpeed,
      altMinReadingSpeed: newStatistic.altMinReadingSpeed,
      lastReadingSpeed: newStatistic.lastReadingSpeed,
      maxReadingSpeed: newStatistic.maxReadingSpeed,
      lastStatisticModified: newStatistic.lastStatisticModified
    };

    await db.put('statistic', existingStatistic);
    this.statisticsChanged$.next();
  }

  /**
   * Insert-or-merge a manual reading record (paper book, backfill, etc.).
   * The [title, dateKey] pair is the primary key, so this doubles as an
   * upsert for the "append to existing day" workflow. `overwrite` replaces
   * the day's totals wholesale; the default `append` semantics add on top.
   *
   * Manual entries record no per-hour session data — they never feed the
   * `session` store, only the aggregate `statistic` row. Speed columns are
   * derived from the final time/chars pair; if chars is 0 the UI shows "—"
   * instead of "0 / h" (see statistics-summary.svelte).
   */
  async upsertManualStatistic(entry: {
    title: string;
    dateKey: string;
    readingTimeSeconds: number;
    charactersRead: number;
    markCompleted: boolean;
    conflictStrategy: 'append' | 'overwrite';
  }): Promise<{ statistic: BooksDbStatistic; existed: boolean }> {
    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const existing = await statisticsStore.get([entry.title, entry.dateKey]);
      const now = Date.now();

      let readingTime = entry.readingTimeSeconds;
      let charactersRead = entry.charactersRead;

      if (existing && entry.conflictStrategy === 'append') {
        readingTime = (existing.readingTime || 0) + entry.readingTimeSeconds;
        charactersRead = (existing.charactersRead || 0) + entry.charactersRead;
      }

      const speed = readingTime > 0 ? Math.ceil((3600 * charactersRead) / readingTime) : 0;

      const merged: BooksDbStatistic = {
        title: entry.title,
        dateKey: entry.dateKey,
        readingTime,
        charactersRead,
        minReadingSpeed: speed,
        altMinReadingSpeed: speed,
        lastReadingSpeed: speed,
        maxReadingSpeed: speed,
        lastStatisticModified: now,
        completedBook: entry.markCompleted ? 1 : existing?.completedBook,
        completedData: entry.markCompleted
          ? {
              dateKey: entry.dateKey,
              readingTime,
              charactersRead,
              minReadingSpeed: speed,
              altMinReadingSpeed: speed,
              lastReadingSpeed: speed,
              maxReadingSpeed: speed,
              completedBook: 1
            }
          : existing?.completedData
      };

      if (!merged.completedBook) {
        delete merged.completedBook;
        delete merged.completedData;
      }

      await statisticsStore.put(merged);
      await lastModifiedStore.put({
        title: entry.title,
        dataType: StorageDataType.STATISTICS,
        lastModifiedValue: now
      });

      await tx.done;
      this.statisticsChanged$.next();

      return { statistic: merged, existed: !!existing };
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }
      throw error;
    }
  }

  async clearZombieStatistics() {
    try {
      const db = await this.db;
      const books = await db.getAll('data');
      const titles = new Set(books.map((book) => book.title));
      const statistics = await db.getAll('statistic');
      const lastModifiedForStatistics = await db.getAll('lastModified');
      const statisticsToDelete: BooksDbStatistic[] = [];
      const lastModifiedItemsToDelete = new Set<string>();

      for (let index = 0, { length } = statistics; index < length; index += 1) {
        const entry = statistics[index];

        if (!titles.has(entry.title)) {
          statisticsToDelete.push(entry);
        }
      }

      for (let index = 0, { length } = lastModifiedForStatistics; index < length; index += 1) {
        const entry = lastModifiedForStatistics[index];

        if (!titles.has(entry.title)) {
          lastModifiedItemsToDelete.add(entry.title);
        }
      }

      await this.deleteStatistics(statisticsToDelete, [...lastModifiedItemsToDelete]);
    } catch (error: any) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: '失败',
            message: `删除出错: ${error.message}`
          }
        }
      ]);
    }
  }

  async deleteStatistics(statistics: BooksDbStatistic[], lastModifiedTitlesToDelete: string[]) {
    if (!statistics.length && !lastModifiedTitlesToDelete.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');
    const titlesToDelete = new Set<string>();

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      for (let index = 0, { length } = lastModifiedTitlesToDelete; index < length; index += 1) {
        titlesToDelete.add(lastModifiedTitlesToDelete[index]);
      }

      statistics.forEach((statistic) =>
        tasks.push(
          limiter(async () => {
            try {
              titlesToDelete.add(statistic.title);
              await statisticsStore.delete([statistic.title, statistic.dateKey]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      [...titlesToDelete].forEach((titleToDelete) =>
        tasks.push(
          limiter(async () => {
            try {
              await lastModifiedStore.delete([titleToDelete, StorageDataType.STATISTICS]);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteStatisticEntries(
    bookTitles: string[],
    checkExistingData: boolean,
    startDateString = '',
    endDateString = ''
  ) {
    if (!bookTitles.length || (startDateString && !endDateString)) {
      throw new Error('deleteStatisticEntries 收到无效参数');
    }

    const db = await this.db;
    const tx = db.transaction(['statistic', 'lastModified'], 'readwrite');

    try {
      const statisticsStore = tx.objectStore('statistic');
      const lastModifiedStore = tx.objectStore('lastModified');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];
      const dates: string[] = [];
      const lastModifiedValue = Date.now();
      const hadDataMap = new Map<string, boolean>();

      if (startDateString) {
        let { referenceDate, dateString } = advanceDateDays(getDate(startDateString), 0);

        while (dateString <= endDateString) {
          dates.push(dateString);
          ({ dateString } = advanceDateDays(referenceDate));
        }
      }

      bookTitles.forEach((bookTitle) => {
        if (dates.length) {
          dates.forEach((dateKey) => {
            tasks.push(
              limiter(async () => {
                try {
                  await statisticsStore.delete([bookTitle, dateKey]);
                } catch (error: any) {
                  limiter.clearQueue();

                  throw error;
                }
              })
            );
          });
        } else {
          tasks.push(
            limiter(async () => {
              try {
                const keyRange = IDBKeyRange.bound([bookTitle], [bookTitle, []]);

                if (checkExistingData && !hadDataMap.has(bookTitle)) {
                  const hadData = !!(await statisticsStore.getKey(keyRange));

                  hadDataMap.set(bookTitle, hadData);
                }

                await statisticsStore.delete(keyRange);
              } catch (error: any) {
                limiter.clearQueue();

                throw error;
              }
            })
          );
        }

        tasks.push(
          limiter(async () => {
            try {
              if (!checkExistingData || hadDataMap.get(bookTitle)) {
                await lastModifiedStore.put({
                  title: bookTitle,
                  dataType: StorageDataType.STATISTICS,
                  lastModifiedValue
                });
              }
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        );
      });

      await Promise.all(tasks);
      await tx.done;
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async getReadingGoals() {
    const db = await this.db;

    return db.getAll('readingGoal');
  }

  async getOpenReadingGoals() {
    const db = await this.db;

    return db.getAllFromIndex('readingGoal', 'goalEndDate', '');
  }

  async getCurrentClosedReadingGoal(referenceDate: string) {
    const db = await this.db;
    const readingGoals = await db.getAll('readingGoal', IDBKeyRange.upperBound(referenceDate));

    return readingGoals.find((readingGoal) => readingGoal.goalEndDate >= referenceDate);
  }

  async getReadingGoalsForDateWindow(startDate: string, newStartDate = '', endDate = '') {
    const readingGoals = await this.getReadingGoals();

    if (newStartDate) {
      return readingGoals.filter(
        (readingGoal) =>
          !readingGoal.goalEndDate ||
          (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
          (readingGoal.goalStartDate >= startDate &&
            (!endDate || readingGoal.goalStartDate <= endDate)) ||
          (newStartDate >= readingGoal.goalStartDate && newStartDate <= readingGoal.goalEndDate) ||
          readingGoal.goalStartDate >= newStartDate
      );
    }

    return readingGoals.filter(
      (readingGoal) =>
        !readingGoal.goalEndDate ||
        (startDate >= readingGoal.goalStartDate && startDate <= readingGoal.goalEndDate) ||
        (readingGoal.goalStartDate >= startDate &&
          (!endDate || readingGoal.goalStartDate <= endDate))
    );
  }

  async updateReadingGoals(
    readingGoalsToDelete: string[],
    readingGoalsToInsert: BooksDbReadingGoal[]
  ) {
    if (!readingGoalsToDelete.length && !readingGoalsToInsert.length) {
      return;
    }

    const db = await this.db;
    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const store = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      readingGoalsToDelete.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await store.delete(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      readingGoalsToInsert.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await store.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(Date.now());
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async storeReadingGoals(
    readingGoals: BooksDbReadingGoal[],
    saveBehavior: ReplicationSaveBehavior,
    readingGoalsMergeMode: MergeMode,
    lastGoalModified: number
  ) {
    const db = await this.db;

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (readingGoalsMergeMode === MergeMode.MERGE) {
      const existingReadingGoals = await this.getReadingGoals();

      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingReadingGoals,
        saveBehavior === ReplicationSaveBehavior.NewOnly,
        newReadingGoalModified
      ));
    }

    const tx = db.transaction(['readingGoal'], 'readwrite');

    try {
      const readingGoalStore = tx.objectStore('readingGoal');
      const limiter = pLimit(1);
      const tasks: Promise<void>[] = [];

      readingGoalsToStore.sort(readingGoalSortFunction);

      tasks.push(
        limiter(async () => {
          try {
            await readingGoalStore.clear();
          } catch (error: any) {
            limiter.clearQueue();

            throw error;
          }
        })
      );

      readingGoalsToStore.forEach((readingGoal) =>
        tasks.push(
          limiter(async () => {
            try {
              await readingGoalStore.put(readingGoal);
            } catch (error: any) {
              limiter.clearQueue();

              throw error;
            }
          })
        )
      );

      await Promise.all(tasks);
      await tx.done;

      lastReadingGoalsModified$.next(newReadingGoalModified);

      const currentUserGoal = await getCurrentReadingGoal();

      readingGoal$.next(currentUserGoal);
    } catch (error: any) {
      try {
        tx.abort();
        await tx.done;
      } catch (_) {
        // no-op
      }

      throw error;
    }
  }

  async deleteReadingGoal(dateKey?: string) {
    const db = await this.db;

    if (dateKey) {
      await db.delete('readingGoal', dateKey);
    } else {
      await db.clear('readingGoal');
    }

    lastReadingGoalsModified$.next(Date.now());
  }

  async getAudioBook(title: string) {
    const db = await this.db;

    return db.get('audioBook', title);
  }

  async getSubtitleData(title: string) {
    const db = await this.db;

    return db.get('subtitle', title);
  }
}
