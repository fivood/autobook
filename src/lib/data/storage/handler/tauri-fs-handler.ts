/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Storage handler backed by the local filesystem via the Tauri fs plugin.
 * Mirrors the on-disk layout of FilesystemStorageHandler so the data is
 * cross-compatible, but uses path strings instead of FileSystemDirectoryHandle.
 */

import type {
  BooksDbAudioBook,
  BooksDbBookData,
  BooksDbBookmarkData,
  BooksDbReadingGoal,
  BooksDbStatistic,
  BooksDbSubtitleData,
  BooksDbHighlight
} from '$lib/data/database/books-db/versions/books-db';

import { database, fsRoot$ } from '$lib/data/store';
import { mergeReadingGoals, readingGoalSortFunction } from '$lib/data/reading-goal';
import { mergeStatistics, updateStatisticToStore } from '$lib/functions/statistic-util';
import { BaseStorageHandler, FilePrefix } from '$lib/data/storage/handler/base-handler';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import pLimit from 'p-limit';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';
import { throwIfAborted } from '$lib/functions/replication/replication-error';

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  writeFile
} from '@tauri-apps/plugin-fs';

const DEFAULT_ROOT_DIR = 'AutoBook';

interface FileEntry {
  name: string;
  /** path relative to `baseDir`, or absolute when `baseDir` is undefined */
  path: string;
}

interface RootConfig {
  rootDir: string;
  /** undefined = absolute path mode (custom fsRoot); Document = default AutoBook folder. */
  baseDir: BaseDirectory | undefined;
}

/**
 * Resolve current root. Empty fsRoot$ = default Documents/AutoBook via
 * BaseDirectory.Document. Non-empty = absolute path, baseDir omitted.
 */
function currentRoot(): RootConfig {
  const configured = fsRoot$.getValue().trim();
  if (configured) {
    return { rootDir: configured, baseDir: undefined };
  }
  return { rootDir: DEFAULT_ROOT_DIR, baseDir: BaseDirectory.Document };
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function fileFromBytes(bytes: Uint8Array, name: string, mimeType = ''): File {
  return new File([new Uint8Array(bytes)], name, mimeType ? { type: mimeType } : undefined);
}

export class TauriFsStorageHandler extends BaseStorageHandler {
  private rootReady = false;

  private titleToFiles = new Map<string, FileEntry[]>();

  private rootFileEntries = new Map<string, FileEntry>();

  private rootDir = DEFAULT_ROOT_DIR;

  private baseDir: BaseDirectory | undefined = BaseDirectory.Document;

  private lastFsRoot = '';

  updateSettings(
    window: Window,
    isForBrowser: boolean,
    saveBehavior: ReplicationSaveBehavior,
    statisticsMergeMode: MergeMode,
    readingGoalsMergeMode: MergeMode,
    cacheStorageData: boolean,
    askForStorageUnlock: boolean,
    _storageSourceName: string
  ) {
    this.window = window;
    this.isForBrowser = isForBrowser;
    this.saveBehavior = saveBehavior;
    this.statisticsMergeMode = statisticsMergeMode;
    this.readingGoalsMergeMode = readingGoalsMergeMode;
    this.cacheStorageData = cacheStorageData;
    this.askForStorageUnlock = askForStorageUnlock;
    this.storageSourceName = InternalStorageSources.INTERNAL_TAURI_FS;

    // Re-read the configured root. If it changed since last call (user picked a
    // new folder), drop any cached listings so we don't serve stale data.
    const current = fsRoot$.getValue().trim();
    if (current !== this.lastFsRoot) {
      this.lastFsRoot = current;
      this.clearData(true);
    }
    const resolved = currentRoot();
    this.rootDir = resolved.rootDir;
    this.baseDir = resolved.baseDir;
  }

  clearData(clearAll = true) {
    this.titleToFiles.clear();
    this.rootFileEntries.clear();
    this.rootFiles.clear();
    this.rootFileListFetched = false;
    if (clearAll) {
      this.titleToBookCard.clear();
      this.dataListFetched = false;
      this.rootReady = false;
    }
  }

  async getBookList() {
    if (!this.dataListFetched) {
      database.listLoading$.next(true);

      try {
        await this.ensureRoot();
        const entries = await readDir(this.rootDir, { baseDir: this.baseDir });
        const directories = entries
          .filter((e) => e.isDirectory)
          .map((e) => e.name as string);

        await this.setTitleData(directories);
        this.dataListFetched = true;
      } catch (err) {
        console.error('[TauriFsStorageHandler] getBookList failed:', err);
        this.dataListFetched = true;
      }
    }
    return [...this.titleToBookCard.values()];
  }

  async prepareBookForReading(): Promise<number> {
    const book = await database.getDataByTitle(this.currentContext.title);
    let idToReturn = 0;
    let data: Omit<BooksDbBookData, 'id'> | undefined = book;

    if (!data || !data.elementHtml) {
      const { file } = await this.getExternalFile('bookdata_');
      data = file
        ? data || {
            title: this.currentContext.title,
            styleSheet: '',
            elementHtml: '',
            blobs: {},
            coverImage: '',
            hasThumb: true,
            characters: 0,
            sections: [],
            lastBookModified: 0,
            lastBookOpen: 0,
            storageSource: undefined
          }
        : undefined;
    }

    if (!data) {
      throw new Error('未找到本地或外部书籍数据');
    }

    if (data.storageSource !== this.storageSourceName) {
      data.storageSource = this.storageSourceName;
      idToReturn = await getStorageHandler(
        this.window,
        StorageKey.BROWSER,
        undefined,
        true,
        this.cacheStorageData,
        ReplicationSaveBehavior.Overwrite
      ).saveBook(data, true, false);
    } else if (book?.id) {
      idToReturn = book.id;
    }

    return idToReturn;
  }

  async updateLastRead(book: BooksDbBookData) {
    const { file, files, dirPath } = await this.getExternalFile('bookdata_');
    if (!file) return;

    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    const oldFilename = file.name;
    const filename = BaseStorageHandler.getBookFileName(book);
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    await this.writeFileTo(dirPath, filename, bytes, files, file);
    if (oldFilename !== filename) {
      // writeFileTo removes old; nothing to do
    }

    this.addBookCard(this.currentContext.title, { characters, lastBookModified, lastBookOpen });
  }

  async getFilenameForRecentCheck(fileIdentifier: string) {
    if (this.saveBehavior === ReplicationSaveBehavior.Overwrite) {
      BaseStorageHandler.reportProgress();
      return undefined;
    }
    const { file } = this.validRootFiles.includes(fileIdentifier)
      ? await this.getRootFile(fileIdentifier)
      : await this.getExternalFile(fileIdentifier, 1);
    return file?.name;
  }

  async isBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile('bookdata_', 1);
    if (!file) return false;
    const { lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(referenceFilename);
    const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
      BaseStorageHandler.getBookMetadata(file.name);
    return !!(
      existingBookModified &&
      lastBookModified &&
      existingBookModified >= lastBookModified &&
      (existingBookOpen || 0) >= (lastBookOpen || 0)
    );
  }

  async isProgressPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile('progress_', 1);
    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getProgressMetadata,
      'lastBookmarkModified',
      referenceFilename,
      file?.name
    );
  }

  async areStatisticsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile('statistics_', 1);
    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getStatisticsMetadata,
      'lastStatisticModified',
      referenceFilename,
      file?.name
    );
  }

  async areReadingGoalsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix);
    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getReadingGoalsMetadata,
      'lastGoalModified',
      referenceFilename,
      file?.name
    );
  }

  async isAudioBookPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile(FilePrefix.AUDIO_BOOK, 1);
    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbAudioBook>(
      BaseStorageHandler.getAudioBookMetadata,
      'lastAudioBookModified',
      referenceFilename,
      file?.name
    );
  }

  async isSubtitleDataPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile(FilePrefix.SUBTITLE, 1);
    return BaseStorageHandler.checkIsPresentAndUpToDate<BooksDbSubtitleData>(
      BaseStorageHandler.getSubtitleDataMetadata,
      'lastSubtitleDataModified',
      referenceFilename,
      file?.name
    );
  }

  async areHighlightsPresentAndUpToDate(referenceFilename: string | undefined) {
    if (!referenceFilename) {
      BaseStorageHandler.reportProgress();
      return false;
    }
    const { file } = await this.getExternalFile(FilePrefix.HIGHLIGHT, 1);
    return BaseStorageHandler.checkIsPresentAndUpToDate(
      BaseStorageHandler.getHighlightsMetadata,
      'lastHighlightModified',
      referenceFilename,
      file?.name
    );
  }

  async getBook(onProgress?: (done: number, total: number) => void) {
    const { file } = await this.getExternalFile('bookdata_', this.isForBrowser ? 0.4 : 0.8);
    if (!file) return undefined;
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    const bookFile = fileFromBytes(bytes, file.name);
    return this.isForBrowser
      ? this.extractBookData(bookFile, bookFile.name, 0.6, onProgress)
      : bookFile;
  }

  async getProgress() {
    const { file } = await this.getExternalFile('progress_', this.isForBrowser ? 0.6 : 0.8);
    if (!file) return undefined;
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    if (this.isForBrowser) {
      const text = new TextDecoder().decode(bytes);
      BaseStorageHandler.reportProgress(0.4);
      return JSON.parse(text);
    }
    return fileFromBytes(bytes, file.name);
  }

  async getStatistics() {
    const { file } = await this.getExternalFile('statistics_', 0.6);
    if (!file) return { statistics: undefined, lastStatisticModified: 0 };
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    const statistics = JSON.parse(new TextDecoder().decode(bytes));
    BaseStorageHandler.reportProgress(0.4);
    return {
      statistics,
      lastStatisticModified: BaseStorageHandler.getStatisticsMetadata(file.name)
        .lastStatisticModified
    };
  }

  async getCover() {
    if (this.currentContext.imagePath instanceof Blob) {
      BaseStorageHandler.reportProgress();
      return this.currentContext.imagePath;
    }
    const { file } = await this.getExternalFile('cover_', 0.8);
    if (!file) return undefined;
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    return new Blob([new Uint8Array(bytes)], {
      type: BaseStorageHandler.getImageMimeTypeFromExtension(file.name)
    });
  }

  async getReadingGoals() {
    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix, 0.6);
    if (!file) return { readingGoals: undefined, lastGoalModified: 0 };
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    const readingGoals = JSON.parse(new TextDecoder().decode(bytes));
    BaseStorageHandler.reportProgress(0.4);
    return {
      readingGoals,
      lastGoalModified: BaseStorageHandler.getReadingGoalsMetadata(file.name).lastGoalModified
    };
  }

  async getAudioBook() {
    const { file } = await this.getExternalFile(
      FilePrefix.AUDIO_BOOK,
      this.isForBrowser ? 0.6 : 0.8
    );
    if (!file) return undefined;
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    if (this.isForBrowser) {
      const audioBook = JSON.parse(new TextDecoder().decode(bytes));
      BaseStorageHandler.reportProgress(0.4);
      return audioBook;
    }
    return fileFromBytes(bytes, file.name);
  }

  async getSubtitleData() {
    const { file } = await this.getExternalFile(FilePrefix.SUBTITLE, this.isForBrowser ? 0.6 : 0.8);
    if (!file) return undefined;
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    if (this.isForBrowser) {
      const subtitleData = JSON.parse(new TextDecoder().decode(bytes));
      BaseStorageHandler.reportProgress(0.4);
      return subtitleData;
    }
    return fileFromBytes(bytes, file.name);
  }

  async getHighlightData() {
    const { file } = await this.getExternalFile(FilePrefix.HIGHLIGHT, 0.6);
    if (!file) return { highlights: undefined, lastHighlightModified: 0 };
    const bytes = await readFile(file.path, { baseDir: this.baseDir });
    const highlights = JSON.parse(new TextDecoder().decode(bytes));
    BaseStorageHandler.reportProgress(0.4);
    return {
      highlights,
      lastHighlightModified: BaseStorageHandler.getHighlightsMetadata(file.name).lastHighlightModified
    };
  }

  async saveBook(data: Omit<BooksDbBookData, 'id'> | File, skipTimestampFallback = true) {
    const isFile = data instanceof File;
    const { file, files, dirPath } = await this.getExternalFile('bookdata_', 0.2);
    const filename = BaseStorageHandler.getBookFileName(
      data,
      file && skipTimestampFallback ? '' : file?.name
    );
    const { characters, lastBookModified, lastBookOpen } =
      BaseStorageHandler.getBookMetadata(filename);

    if (file && this.saveBehavior === ReplicationSaveBehavior.NewOnly) {
      const { lastBookModified: existingBookModified, lastBookOpen: existingBookOpen } =
        BaseStorageHandler.getBookMetadata(file.name);
      if (
        existingBookModified &&
        lastBookModified &&
        existingBookModified >= lastBookModified &&
        (existingBookOpen || 0) >= (lastBookOpen || 0)
      ) {
        return 0;
      }
    }

    let bookBytes: Uint8Array;
    if (isFile) {
      bookBytes = new Uint8Array(await data.arrayBuffer());
      BaseStorageHandler.reportProgress(0.2);
    } else {
      const zipped = await this.zipBookData(data, 0.4);
      bookBytes = new Uint8Array(await zipped.arrayBuffer());
    }

    await this.writeFileTo(dirPath, filename, bookBytes, files, file, isFile ? 0.6 : 0.4);
    this.addBookCard(this.currentContext.title, { characters, lastBookModified, lastBookOpen });
    return 0;
  }

  async saveProgress(data: BooksDbBookmarkData | File) {
    const filename = BaseStorageHandler.getProgressFileName(data);
    const { lastBookmarkModified, progress } = BaseStorageHandler.getProgressMetadata(filename);
    const { file, files, dirPath } = await this.getExternalFile('progress_');

    const bytes =
      data instanceof File
        ? new Uint8Array(await data.arrayBuffer())
        : new TextEncoder().encode(JSON.stringify(data));

    await this.writeFileTo(dirPath, filename, bytes, files, file, 0.6);
    this.addBookCard(this.currentContext.title, { lastBookmarkModified, progress });
  }

  async saveStatistics(statistics: BooksDbStatistic[], lastStatisticModified: number) {
    const isMerge = this.statisticsMergeMode === MergeMode.MERGE;
    const { file, files, dirPath } = await this.getExternalFile('statistics_');

    let statisticsToStore: BooksDbStatistic[] = statistics;
    let newStatisticModified = lastStatisticModified;

    if (isMerge) {
      let existingData: BooksDbStatistic[] = [];
      if (file) {
        const bytes = await readFile(file.path, { baseDir: this.baseDir });
        existingData = JSON.parse(new TextDecoder().decode(bytes));
      }
      statisticsToStore = mergeStatistics(
        statistics,
        existingData,
        this.saveBehavior === ReplicationSaveBehavior.NewOnly
      );
    }

    ({ statisticsToStore, newStatisticModified } = updateStatisticToStore(
      statisticsToStore,
      newStatisticModified
    ));

    const filename = BaseStorageHandler.getStatisticsFileName(
      statisticsToStore,
      newStatisticModified
    );
    await this.writeFileTo(
      dirPath,
      filename,
      new TextEncoder().encode(JSON.stringify(statisticsToStore)),
      files,
      file,
      0.6
    );
    this.addBookCard(this.currentContext.title, {});
  }

  async saveCover(data: Blob | undefined) {
    if (!data) {
      BaseStorageHandler.reportProgress();
      return;
    }
    const { file, files, dirPath } = await this.getExternalFile('cover_');
    if (!file) {
      const filename = await BaseStorageHandler.getCoverFileName(data);
      const bytes = new Uint8Array(await data.arrayBuffer());
      await this.writeFileTo(dirPath, filename, bytes, files, undefined, 0.6);
    }
    if (this.titleToBookCard.has(this.currentContext.title)) {
      this.addBookCard(this.currentContext.title, { imagePath: data });
    }
  }

  async saveReadingGoals(readingGoals: BooksDbReadingGoal[], lastGoalModified: number) {
    const isMerge = this.readingGoalsMergeMode === MergeMode.MERGE;
    const { file } = await this.getRootFile(BaseStorageHandler.readingGoalsFilePrefix, 0.4);

    let readingGoalsToStore: BooksDbReadingGoal[] = readingGoals;
    let newReadingGoalModified = lastGoalModified;

    if (isMerge) {
      let existingData: BooksDbReadingGoal[] = [];
      if (file) {
        const bytes = await readFile(file.path, { baseDir: this.baseDir });
        existingData = JSON.parse(new TextDecoder().decode(bytes));
      }
      ({ readingGoalsToStore, newReadingGoalModified } = mergeReadingGoals(
        readingGoals,
        existingData,
        this.saveBehavior === ReplicationSaveBehavior.NewOnly,
        lastGoalModified
      ));
    }

    readingGoalsToStore.sort(readingGoalSortFunction);
    const filename = BaseStorageHandler.getReadingGoalsFileName(newReadingGoalModified);
    await this.writeFileTo(
      this.rootDir,
      filename,
      new TextEncoder().encode(JSON.stringify(readingGoalsToStore)),
      [],
      file,
      0.6,
      BaseStorageHandler.readingGoalsFilePrefix
    );
  }

  async saveAudioBook(data: BooksDbAudioBook | File) {
    const filename = BaseStorageHandler.getAudioBookFileName(data);
    const { file, files, dirPath } = await this.getExternalFile(FilePrefix.AUDIO_BOOK);
    const bytes =
      data instanceof File
        ? new Uint8Array(await data.arrayBuffer())
        : new TextEncoder().encode(JSON.stringify(data));
    await this.writeFileTo(dirPath, filename, bytes, files, file, 0.6);
  }

  async saveSubtitleData(data: BooksDbSubtitleData | File) {
    const filename = BaseStorageHandler.getSubtitleDataFileName(data);
    const { file, files, dirPath } = await this.getExternalFile(FilePrefix.SUBTITLE);
    const bytes =
      data instanceof File
        ? new Uint8Array(await data.arrayBuffer())
        : new TextEncoder().encode(JSON.stringify(data));
    await this.writeFileTo(dirPath, filename, bytes, files, file, 0.6);
  }

  async saveHighlightData(data: BooksDbHighlight[] | File, lastHighlightModified: number) {
    const filename = BaseStorageHandler.getHighlightsFileName(data, lastHighlightModified);
    const { file, files, dirPath } = await this.getExternalFile(FilePrefix.HIGHLIGHT);
    const bytes =
      data instanceof File
        ? new Uint8Array(await data.arrayBuffer())
        : new TextEncoder().encode(JSON.stringify(data));
    await this.writeFileTo(dirPath, filename, bytes, files, file, 0.6);
  }

  async deleteBookData(booksToDelete: string[], cancelSignal: AbortSignal) {
    await this.ensureRoot();
    const deleted: number[] = [];
    const deletionLimiter = pLimit(1);
    const deleteTasks: Promise<void>[] = [];
    let error = '';

    replicationProgress$.next({ progressBase: 1, maxProgress: booksToDelete.length });

    booksToDelete.forEach((bookToDelete) =>
      deleteTasks.push(
        deletionLimiter(async () => {
          try {
            throwIfAborted(cancelSignal);
            const sanitized = BaseStorageHandler.sanitizeForFilename(bookToDelete);
            const bookDir = joinPath(this.rootDir, sanitized);
            await remove(bookDir, { baseDir: this.baseDir, recursive: true });

            const deletedId = this.titleToBookCard.get(bookToDelete)?.id;
            if (deletedId) deleted.push(deletedId);

            this.titleToFiles.delete(bookToDelete);
            this.titleToBookCard.delete(bookToDelete);
            database.dataListChanged$.next(this);
            BaseStorageHandler.reportProgress();
          } catch (err) {
            error = handleErrorDuringReplication(err, `Error deleting ${bookToDelete}: `, [
              deletionLimiter
            ]);
          }
        })
      )
    );

    await Promise.all(deleteTasks).catch(() => {});
    return { error, deleted };
  }

  // --- helpers ---

  private async ensureRoot(): Promise<void> {
    if (this.rootReady) return;
    const present = await exists(this.rootDir, { baseDir: this.baseDir });
    if (!present) {
      await mkdir(this.rootDir, { baseDir: this.baseDir, recursive: true });
    }
    this.rootReady = true;
  }

  private async setTitleData(directoryNames: string[]) {
    const listLimiter = pLimit(1);
    const tasks: Promise<void>[] = [];

    directoryNames.forEach((dirName) =>
      tasks.push(
        listLimiter(async () => {
          try {
            const bookDirPath = joinPath(this.rootDir, dirName);
            const entries = await readDir(bookDirPath, { baseDir: this.baseDir });
            const files: FileEntry[] = entries
              .filter((e) => e.isFile)
              .map((e) => ({ name: e.name as string, path: joinPath(bookDirPath, e.name as string) }));

            if (!files.length) return;

            const title = BaseStorageHandler.desanitizeFilename(dirName);
            const bookCard: BookCardProps = {
              id: BaseStorageHandler.stableIdFromTitle(title),
              title,
              imagePath: '',
              characters: 0,
              lastBookModified: 0,
              lastBookOpen: 0,
              progress: 0,
              lastBookmarkModified: 0,
              isPlaceholder: false
            };

            for (const file of files) {
              if (file.name.startsWith('bookdata_')) {
                const m = BaseStorageHandler.getBookMetadata(file.name);
                bookCard.characters = m.characters;
                bookCard.lastBookModified = m.lastBookModified;
                bookCard.lastBookOpen = m.lastBookOpen;
                if (m.originalFormat) bookCard.originalFormat = m.originalFormat;
              } else if (file.name.startsWith('progress_')) {
                const m = BaseStorageHandler.getProgressMetadata(file.name);
                bookCard.lastBookmarkModified = m.lastBookmarkModified;
                bookCard.progress = m.progress;
              } else if (file.name.startsWith('cover_')) {
                const bytes = await readFile(file.path, { baseDir: this.baseDir });
                bookCard.imagePath = new Blob([new Uint8Array(bytes)], {
                  type: BaseStorageHandler.getImageMimeTypeFromExtension(file.name)
                });
              }
            }

            this.titleToFiles.set(bookCard.title, files);
            this.titleToBookCard.set(bookCard.title, bookCard);
          } catch (err) {
            listLimiter.clearQueue();
            throw err;
          }
        })
      )
    );

    await Promise.all(tasks).catch((err) => {
      this.clearData();
      throw err;
    });
  }

  private async getExternalFile(fileIdentifier: string, progressBase = 0.4) {
    const progressPerStep = progressBase / 2;
    await this.ensureRoot();
    BaseStorageHandler.reportProgress(progressPerStep);

    const files = await this.getExternalFiles();
    const file = files.find((e) => e.name.startsWith(fileIdentifier));
    const dirPath = joinPath(this.rootDir, this.sanitizedTitle);
    BaseStorageHandler.reportProgress(progressPerStep);
    return { file, files, dirPath };
  }

  private async getRootFile(fileIdentifier: string, progressBase = 1) {
    const progressPerStep = progressBase / 2;
    await this.ensureRoot();
    BaseStorageHandler.reportProgress(progressPerStep);
    await this.setRootFiles();
    return { file: this.rootFileEntries.get(fileIdentifier) };
  }

  private async getExternalFiles(): Promise<FileEntry[]> {
    if (
      (!this.cacheStorageData || !this.dataListFetched) &&
      !this.titleToFiles.has(this.currentContext.title)
    ) {
      const bookDirPath = joinPath(this.rootDir, this.sanitizedTitle);
      if (await exists(bookDirPath, { baseDir: this.baseDir })) {
        await this.setTitleData([this.sanitizedTitle]);
      }
    }
    return this.titleToFiles.get(this.currentContext.title) || [];
  }

  private async setRootFiles() {
    if ((!this.cacheStorageData || !this.rootFileListFetched) && !this.rootFiles.size) {
      const entries = await readDir(this.rootDir, { baseDir: this.baseDir });
      const files = entries
        .filter((e) => e.isFile)
        .map((e) => ({ name: e.name as string, path: joinPath(this.rootDir, e.name as string) }));

      for (const f of files) {
        for (const validPrefix of this.validRootFiles) {
          if (f.name.startsWith(validPrefix)) {
            this.rootFileEntries.set(validPrefix, f);
          }
        }
      }
      this.rootFileListFetched = true;
    }
  }

  private async writeFileTo(
    dirPath: string,
    filename: string,
    data: Uint8Array,
    files: FileEntry[],
    file: FileEntry | undefined,
    progressBase = 0.4,
    rootFilePrefix?: string
  ) {
    const progressPerStep = progressBase / 2;
    const targetDir = rootFilePrefix
      ? this.rootDir
      : (() => {
          // Ensure the per-book directory exists
          return dirPath;
        })();

    if (!rootFilePrefix) {
      const dirExists = await exists(targetDir, { baseDir: this.baseDir });
      if (!dirExists) await mkdir(targetDir, { baseDir: this.baseDir, recursive: true });
    }

    const newPath = joinPath(targetDir, filename);
    await writeFile(newPath, data, { baseDir: this.baseDir });
    BaseStorageHandler.reportProgress(progressPerStep);

    if (file && file.path !== newPath) {
      try {
        await remove(file.path, { baseDir: this.baseDir });
      } catch {
        // best effort
      }
    }

    const newEntry: FileEntry = { name: filename, path: newPath };

    if (rootFilePrefix) {
      this.rootFileEntries.set(rootFilePrefix, newEntry);
    } else {
      const updated = files.filter((e) => e.name !== (file?.name ?? '') && e.name !== filename);
      updated.push(newEntry);
      this.titleToFiles.set(this.currentContext.title, updated);
    }
    BaseStorageHandler.reportProgress(progressPerStep);
  }
}
