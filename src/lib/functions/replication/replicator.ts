/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BackupStorageHandler } from '$lib/data/storage/handler/backup-handler';
import { BaseStorageHandler, FilePrefix } from '$lib/data/storage/handler/base-handler';
import { storage } from '$lib/data/window/navigator/storage';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import { database, requestPersistentStorage$ } from '$lib/data/store';
import { sniffFormat, sniffZipKind } from '$lib/functions/file-loaders/utils/sniff-format';

// dev-only console toggle: window.__forceNativeMobi(true) forces the built-in
// MOBI parser, bypassing Calibre. Lazy-loads the MOBI module so the parser
// (and its dep tree) stays off the /manage bundle for users who never touch it.
if (typeof window !== 'undefined') {
  (window as any).__forceNativeMobi = async (val = true) => {
    const { setForceNativeParser } = await import('$lib/functions/file-loaders/mobi/load-mobi');
    setForceNativeParser(val);
    console.info(val ? '已切换到内置 MOBI 解析器' : '已恢复 Calibre 优先模式');
  };
}

import type { LoadData } from '$lib/functions/file-loaders/types';

// Every format loader below is imported per-branch so the /manage entry
// bundle isn't dragged into loading pdfjs / hljs / katex / marked /
// libarchive / mobi-parser upfront. Only the format the user actually
// imports pays the code-split cost.
const loadEpub = () => import('$lib/functions/file-loaders/epub/load-epub').then((m) => m.default);
const loadTxt = () => import('$lib/functions/file-loaders/txt/load-txt').then((m) => m.default);
const loadMd = () => import('$lib/functions/file-loaders/md/load-md').then((m) => m.default);
const loadMobi = () =>
  import('$lib/functions/file-loaders/mobi/load-mobi').then((m) => m.default);
const loadPdf = () => import('$lib/functions/file-loaders/pdf/load-pdf').then((m) => m.default);
const loadCbz = () => import('$lib/functions/file-loaders/cbz/load-cbz').then((m) => m.default);
const loadCbr = () => import('$lib/functions/file-loaders/cbr/load-cbr').then((m) => m.default);
const loadHtmlz = () =>
  import('$lib/functions/file-loaders/htmlz/load-htmlz').then((m) => m.default);
import { detectSourceFormat } from '$lib/functions/book-format';
import { logger } from '$lib/data/logger';
import { handleErrorDuringReplication } from '$lib/functions/replication/error-handler';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import {
  replicationProgress$,
  type ReplicationContext
} from '$lib/functions/replication/replication-progress';
import pLimit from 'p-limit';

export const exporterVersion = 1;

export async function importData(
  document: Document,
  targetHandler: BaseStorageHandler,
  files: File[],
  cancelSignal: AbortSignal,
  fileCountData?: Record<string, number>
) {
  const dataIds: number[] = [];
  const tasks: Promise<void>[] = [];
  const lastBookModified = new Date().getTime();
  const progressBase = 3; // load -> save -> cover;
  const maxProgress = progressBase * files.length;
  const limiter = pLimit(1);

  let errorMessage = '';

  replicationProgress$.next({ progressBase, maxProgress });

  await persistStorage(targetHandler.storageType);

  if (targetHandler.isCacheDisabled()) {
    targetHandler.clearData(false);
  }

  let newFileData = 0;

  files.forEach((file) =>
    tasks.push(
      limiter(async () => {
        let currentTitle = file.name;

        if (fileCountData && Object.prototype.hasOwnProperty.call(fileCountData, currentTitle)) {
          checkCancelAndProgress(cancelSignal, true, true);
          checkCancelAndProgress(cancelSignal, true, true);
          checkCancelAndProgress(cancelSignal, true, true);

          return;
        }

        try {
          throwIfAborted(cancelSignal);

          let bookContent: LoadData;

          // Step 1: try by extension (fast path, covers 99% of cases).
          // Step 2: if the extension didn't match anything, sniff the magic
          // bytes so renamed/extensionless files still load correctly.
          if (file.name.endsWith('.epub')) {
            bookContent = await (await loadEpub())(file, document, lastBookModified);
          } else if (file.name.endsWith('.txt')) {
            bookContent = await (await loadTxt())(file, lastBookModified);
          } else if (/\.(md|markdown)$/i.test(file.name)) {
            bookContent = await (await loadMd())(file, lastBookModified);
          } else if (/\.(mobi|azw3?)$/i.test(file.name)) {
            bookContent = await (await loadMobi())(file, lastBookModified);
          } else if (/\.pdf$/i.test(file.name)) {
            bookContent = await (await loadPdf())(file, lastBookModified, (page, total) => {
              // Surface per-page progress so a long scanned-PDF import shows a
              // moving bar + live ETA instead of sitting on "load" with
              // `~ ??:??:??`. The load step's budget is 1 progress unit; each
              // page adds its slice, and completeStep() ceil-corrects at the end.
              if (page < total) {
                BaseStorageHandler.reportProgress(1 / total);
              }
            });
          } else if (/\.cbz$/i.test(file.name)) {
            bookContent = await (await loadCbz())(file, lastBookModified);
          } else if (/\.(cbr|cb7|cbt)$/i.test(file.name)) {
            bookContent = await (await loadCbr())(file, lastBookModified);
          } else if (/\.htmlz$/i.test(file.name)) {
            bookContent = await (await loadHtmlz())(file, document, lastBookModified);
          } else {
            const sniffed = await sniffFormat(file);
            if (sniffed === 'pdf') {
              bookContent = await (await loadPdf())(file, lastBookModified, (page, total) => {
                if (page < total) {
                  BaseStorageHandler.reportProgress(1 / total);
                }
              });
            } else if (sniffed === 'mobi') {
              bookContent = await (await loadMobi())(file, lastBookModified);
            } else if (sniffed === 'zip') {
              const kind = await sniffZipKind(file);
              if (kind === 'cbz') {
                bookContent = await (await loadCbz())(file, lastBookModified);
              } else if (kind === 'htmlz') {
                bookContent = await (await loadHtmlz())(file, document, lastBookModified);
              } else {
                // EPUB or fallback to EPUB (most common ZIP-based ebook)
                bookContent = await (await loadEpub())(file, document, lastBookModified);
              }
            } else {
              // Last resort: try EPUB (it'll error out cleanly if not actually one)
              bookContent = await (await loadEpub())(file, document, lastBookModified);
            }
          }

          if (fileCountData) {
            fileCountData[currentTitle] = bookContent.characters;
            checkCancelAndProgress(cancelSignal, true, true);
            checkCancelAndProgress(cancelSignal, true, true);
            checkCancelAndProgress(cancelSignal, true, true);

            newFileData += 1;

            return;
          }

          checkCancelAndProgress(cancelSignal, true, true);

          // 1.20.2: remember the source format so the hover popover +
          // card corner chip can display it even after loaders strip the
          // extension from the title (EPUB/MOBI extract clean titles
          // from EXTH; only TXT/MD/CBZ tend to keep the extension).
          // detectSourceFormat (not detectBookFormat) so a CBR keeps its CBR
          // badge instead of being lumped under CBZ.
          bookContent.originalFormat = detectSourceFormat(file.name);

          currentTitle = bookContent.title;

          // Side channel off the loader — must not reach saveBook, which
          // persists whatever it is handed (IDB row for browser storage, a
          // JSON file on disk for tauri-fs).
          const extractedMetadata = bookContent._extractedMetadata;
          delete bookContent._extractedMetadata;

          targetHandler.startContext(
            { title: bookContent.title, imagePath: bookContent.coverImage || '' },
            cancelSignal
          );

          dataIds.push(await targetHandler.saveBook(bookContent, false));

          if (extractedMetadata) {
            try {
              await database.putBookMetadata({ title: bookContent.title, ...extractedMetadata });
            } catch (error: any) {
              // The book itself imported fine; losing its author line is not
              // worth failing the import over, and the user can fill it in by
              // hand. Warn so it still shows up in the log report.
              logger.warn(`bookMetadata write failed for ${bookContent.title}: ${error?.message}`);
            }
          }

          checkCancelAndProgress(cancelSignal, false);

          if (bookContent.coverImage) {
            await targetHandler.saveCover(bookContent.coverImage);
          }

          database.dataListChanged$.next(targetHandler);

          checkCancelAndProgress(cancelSignal, true, !bookContent.coverImage);
        } catch (error: any) {
          errorMessage = handleErrorDuringReplication(error, `Error importing ${currentTitle}: `, [
            limiter
          ]);
        }
      })
    )
  );

  await Promise.all(tasks).catch(() => {});

  if (fileCountData && newFileData) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(fileCountData)], { type: 'application/json' })
    );
    a.rel = 'noopener';
    a.download = 'characters';

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 1e4);

    setTimeout(() => {
      a.click();
    });
  }

  return errorMessage;
}

export async function importBackup(
  sourceHandler: BackupStorageHandler,
  targetHandler: BaseStorageHandler,
  file: File,
  cancelSignal: AbortSignal
) {
  return replicateData(
    sourceHandler,
    targetHandler,
    true,
    await sourceHandler.setBackupZip(file),
    [
      StorageDataType.DATA,
      StorageDataType.PROGRESS,
      StorageDataType.STATISTICS,
      StorageDataType.READING_GOALS,
      StorageDataType.AUDIOBOOK,
      StorageDataType.SUBTITLE,
      StorageDataType.HIGHLIGHT
    ],
    cancelSignal
  );
}

export async function replicateData(
  sourceHandler: BaseStorageHandler,
  targetHandler: BaseStorageHandler,
  refreshDataList: boolean,
  contexts: ReplicationContext[],
  dataToReplicate: StorageDataType[],
  cancelSignal?: AbortSignal
) {
  const bookOperationsLength = dataToReplicate.filter(
    (entry) => entry !== StorageDataType.READING_GOALS
  ).length;
  const otherOperationsLength = dataToReplicate.length - bookOperationsLength;
  // recent check -> source retrieval -> target storage per data type + retrieve and store cover
  const progressBaseForBookOperations = bookOperationsLength ? bookOperationsLength * 4 + 2 : 0;
  const progressBaseForOtherOperations = otherOperationsLength * 4;
  const maxProgress =
    progressBaseForBookOperations * contexts.length + progressBaseForOtherOperations;
  const processBookData = dataToReplicate.includes(StorageDataType.DATA);
  const processProgressData = dataToReplicate.includes(StorageDataType.PROGRESS);
  const processStatistics = dataToReplicate.includes(StorageDataType.STATISTICS);
  const processReadingGoals = dataToReplicate.includes(StorageDataType.READING_GOALS);
  const processAudioBook = dataToReplicate.includes(StorageDataType.AUDIOBOOK);
  const processSubtitleData = dataToReplicate.includes(StorageDataType.SUBTITLE);
  const processHighlights = dataToReplicate.includes(StorageDataType.HIGHLIGHT);
  const replicationLimiter = pLimit(1);
  const replicationTasks: Promise<void>[] = [];

  let errorMessage = '';
  let processed = 0;

  replicationProgress$.next({ maxProgress });

  await persistStorage(targetHandler.storageType).catch(() => {});

  [sourceHandler, targetHandler].forEach((handler) => {
    if (handler.isCacheDisabled()) {
      handler.clearData(false);
    }
  });

  contexts.forEach((context) =>
    replicationTasks.push(
      replicationLimiter(async () => {
        try {
          throwIfAborted(cancelSignal);

          let dataProcessed = false;

          sourceHandler.startContext(context, cancelSignal);
          targetHandler.startContext(context, cancelSignal);

          if (processBookData) {
            if (
              await targetHandler.isBookPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck('bookdata_')
              )
            ) {
              checkCancelAndProgress(cancelSignal, true, true);
              checkCancelAndProgress(cancelSignal, true, true);
            } else {
              const bookData = await sourceHandler.getBook();

              checkCancelAndProgress(cancelSignal);

              if (bookData) {
                await targetHandler.saveBook(bookData);
                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, bookOperationsLength === 1, !bookData);
            }
          }

          if (processProgressData) {
            if (
              await targetHandler.isProgressPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck('progress_')
              )
            ) {
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
            } else {
              const progressData = await sourceHandler.getProgress();

              checkCancelAndProgress(cancelSignal, !dataProcessed);

              if (progressData) {
                await targetHandler.saveProgress(progressData);

                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, !dataProcessed, !progressData);
            }
          }

          if (processStatistics) {
            if (
              await targetHandler.areStatisticsPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck('statistics_')
              )
            ) {
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
            } else {
              const { statistics, lastStatisticModified } = await sourceHandler.getStatistics();

              checkCancelAndProgress(cancelSignal, !dataProcessed);

              if (statistics) {
                await targetHandler.saveStatistics(statistics, lastStatisticModified);

                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, !dataProcessed, !statistics);
            }
          }

          if (processAudioBook) {
            if (
              await targetHandler.isAudioBookPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck(FilePrefix.AUDIO_BOOK)
              )
            ) {
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
            } else {
              const audioBook = await sourceHandler.getAudioBook();

              checkCancelAndProgress(cancelSignal, !dataProcessed);

              if (audioBook) {
                await targetHandler.saveAudioBook(audioBook);

                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, !dataProcessed, !audioBook);
            }
          }

          if (processSubtitleData) {
            if (
              await targetHandler.isSubtitleDataPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck(FilePrefix.SUBTITLE)
              )
            ) {
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
            } else {
              const subtitleData = await sourceHandler.getSubtitleData();

              checkCancelAndProgress(cancelSignal, !dataProcessed);

              if (subtitleData) {
                await targetHandler.saveSubtitleData(subtitleData);

                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, !dataProcessed, !subtitleData);
            }
          }

          if (processHighlights) {
            if (
              await targetHandler.areHighlightsPresentAndUpToDate(
                await sourceHandler.getFilenameForRecentCheck(FilePrefix.HIGHLIGHT)
              )
            ) {
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
              checkCancelAndProgress(cancelSignal, !dataProcessed, true);
            } else {
              const { highlights, lastHighlightModified } = await sourceHandler.getHighlightData();

              checkCancelAndProgress(cancelSignal, !dataProcessed);

              if (highlights) {
                await targetHandler.saveHighlightData(highlights, lastHighlightModified);

                dataProcessed = true;
              }

              checkCancelAndProgress(cancelSignal, !dataProcessed, !highlights);
            }
          }

          if (dataProcessed) {
            const coverData = await sourceHandler.getCover();

            checkCancelAndProgress(cancelSignal, !coverData);

            await targetHandler.saveCover(coverData);

            checkCancelAndProgress(cancelSignal);

            if (refreshDataList) {
              database.dataListChanged$.next(targetHandler);
            }

            if (targetHandler.storageType === StorageKey.BROWSER && processProgressData) {
              database.bookmarksChanged$.next();
            }
          } else {
            checkCancelAndProgress(cancelSignal, true, true);
            checkCancelAndProgress(cancelSignal, true, true);
          }

          processed += 1;
        } catch (error: any) {
          errorMessage = handleErrorDuringReplication(
            error,
            `Error Processing ${context.title}: `,
            [replicationLimiter],
            progressBaseForBookOperations
          );
        }
      })
    )
  );

  if (processReadingGoals) {
    replicationTasks.push(
      replicationLimiter(async () => {
        try {
          if (
            await targetHandler.areReadingGoalsPresentAndUpToDate(
              await sourceHandler.getFilenameForRecentCheck(
                BaseStorageHandler.readingGoalsFilePrefix
              )
            )
          ) {
            checkCancelAndProgress(cancelSignal, true, true);
            checkCancelAndProgress(cancelSignal, true, true);
          } else {
            const { readingGoals, lastGoalModified } = await sourceHandler.getReadingGoals();

            checkCancelAndProgress(cancelSignal);

            if (readingGoals) {
              await targetHandler.saveReadingGoals(readingGoals, lastGoalModified);
            }

            checkCancelAndProgress(cancelSignal, false, !readingGoals);
          }

          processed += 1;
        } catch (error) {
          errorMessage = handleErrorDuringReplication(
            error,
            `Error Processing Reading Goals: `,
            [replicationLimiter],
            progressBaseForOtherOperations
          );
        }
      })
    );
  }

  await Promise.all(replicationTasks).catch(() => {});

  if (targetHandler instanceof BackupStorageHandler) {
    await targetHandler
      .createExportZip(document, cancelSignal?.aborted || !processed)
      .catch((error) => {
        errorMessage = error.message;
      });
  }

  return errorMessage;
}

async function persistStorage(target: StorageKey) {
  if (target === StorageKey.BROWSER && requestPersistentStorage$.getValue()) {
    try {
      await storage.persist();
    } catch (_) {
      // no-op
    }
  }
}

function checkCancelAndProgress(
  cancelSignal: AbortSignal | undefined,
  allowCancel = true,
  addDefaultProgress = false
) {
  if (allowCancel) {
    throwIfAborted(cancelSignal);
  }

  if (addDefaultProgress) {
    BaseStorageHandler.reportProgress();
  }

  BaseStorageHandler.completeStep();
}
