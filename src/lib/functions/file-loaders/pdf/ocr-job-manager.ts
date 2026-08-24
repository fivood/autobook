/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Module-level singleton state for the running OCR job. Lives outside any
 * Svelte component's lifetime so navigating away from the book that's
 * being OCR'd doesn't kill the job — you can drop a 900-page scan into
 * the queue, leave to read another book, and come back later to apply
 * the result.
 *
 * Only one job runs at a time. The Tesseract worker is heavyweight
 * (lang model in memory) and queueing N concurrent jobs would just
 * thrash. If the user starts a second job, the previous one must be
 * aborted first.
 */

import { writable, type Readable } from 'svelte/store';
import {
  cacheStorageData$,
  database,
  pdfOcrSkippedBookIds$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { mergeOcrResult, runOcr, type OcrProgress } from './pdf-ocr-runner';
import { disposeOcrWorker, type OcrLanguage, type OcrModelProfile } from './pdf-ocr';
export type { OcrLanguage, OcrModelProfile };

/**
 * Push the updated bookData (with new OCR-injected elementHtml + blobs) to
 * the external storage source the book was imported from. Without this, the
 * OCR result lives only in IDB; on next reload `saveExternalLastRead` would
 * still find the stale pre-OCR copy on disk (current versions guard against
 * the clobber, but other devices opening the same book see the unchanged
 * scan). Best-effort — failures are logged, never surfaced to the user, so
 * the local-IDB save still counts as success.
 *
 * Currently only handles Tauri FS — the most common desktop case. Dropbox
 * et al. will get the same treatment in a follow-up; for now the export
 * flow remains the fallback.
 */
async function pushOcrResultToExternalStorage(updated: BooksDbBookData): Promise<void> {
  const source = updated.storageSource;
  if (!source) return;
  if (source !== InternalStorageSources.INTERNAL_TAURI_FS) {
    console.info(`[ocr] not auto-pushing to ${source} (Tauri FS only for now)`);
    return;
  }
  try {
    const handler = getStorageHandler(
      window,
      StorageKey.TAURI_FS,
      source,
      true,
      cacheStorageData$.getValue(),
      replicationSaveBehavior$.getValue(),
      statisticsMergeMode$.getValue(),
      readingGoalsMergeMode$.getValue()
    );
    handler.startContext({
      id: updated.id,
      title: updated.title,
      imagePath: updated.coverImage
    });
    // saveBook signature accepts Omit<BooksDbBookData, 'id'> | File; strip
    // the id since file-name on FS is derived from title + metadata, not id.
    const { id: _id, ...dataWithoutId } = updated;
    await handler.saveBook(dataWithoutId, true);
    console.info('[ocr] synced OCR result to Tauri FS');
  } catch (err) {
    console.warn('[ocr] failed to sync OCR result to external storage', err);
  }
}

function markBookOcrComplete(bookId: number) {
  // Belt-and-suspenders alongside the sentinel inserted by runOcr: once a
  // book finishes OCR (regardless of result quality, or whether the user
  // pressed "应用并刷新"), add it to the per-book skip list so the
  // "detected scanned PDF" banner doesn't re-prompt on later opens. Covers
  // edge cases where every page yielded empty text and the sentinel was
  // somehow not picked up by isScannedPdf.
  const raw = pdfOcrSkippedBookIds$.value || '';
  const ids = new Set(raw.split(',').filter(Boolean).map(Number));
  if (!ids.has(bookId)) {
    ids.add(bookId);
    pdfOcrSkippedBookIds$.next(Array.from(ids).join(','));
  }
}

export type OcrJobStatus = 'running' | 'finished' | 'errored';

export interface OcrJobState {
  /** Pages that produced no text layer. `finished` with this equal to the page
   *  count means the run achieved nothing. */
  failedPages?: number;
  /** Reason for the first failed page, for the banner to quote. */
  firstFailure?: string;
  bookId: number;
  bookTitle: string;
  lang: OcrLanguage;
  profile: OcrModelProfile;
  status: OcrJobStatus;
  progress: OcrProgress;
  /** Set when status is 'errored'; user-friendly message. */
  error?: string;
  startedAt: number;
}

let abortCtrl: AbortController | undefined;
const _store = writable<OcrJobState | null>(null);

export const ocrJob$: Readable<OcrJobState | null> = _store;

export function isOcrJobRunning(): boolean {
  return !!abortCtrl;
}

/**
 * Start a new OCR job. If one is already running this is a no-op (caller
 * should abort first). Doesn't return the job promise — fire-and-forget;
 * subscribe to `ocrJob$` to observe progress.
 */
export function startOcrJob(
  book: BooksDbBookData,
  lang: OcrLanguage,
  profile: OcrModelProfile
): boolean {
  if (abortCtrl) return false;
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  _store.set({
    bookId: book.id,
    bookTitle: book.title,
    lang,
    profile,
    status: 'running',
    progress: { page: 0, total: 0, text: '' },
    startedAt: Date.now()
  });

  (async () => {
    try {
      const { book: updated, failedPages, totalPages, firstFailure } = await runOcr(
        book,
        lang,
        profile,
        (p) => {
          _store.update((s) => (s ? { ...s, progress: p } : s));
        },
        signal
      );
      const db = await database.db;
      // Re-read before writing, like every other writer of this row does.
      // `updated` spreads the book snapshot taken when the job started, and a
      // whole-book OCR runs for minutes with the banner on screen the whole
      // time — the banner writes ocrLang, single-page re-OCR writes
      // elementHtml. Putting the snapshot back reverted whatever the user did
      // meanwhile. Only the fields this run actually produced are taken from
      // it; everything else comes from the current row.
      const fresh = await db.get('data', book.id);
      const merged = mergeOcrResult(fresh ?? book, updated);
      await db.put('data', merged);
      // Only retire the "scanned PDF" banner when something actually came out.
      // A run where every page failed used to land here all the same, and the
      // skip list then made sure the banner never offered a retry again — the
      // book was stuck textless with no route back from the UI.
      if (failedPages < totalPages) {
        markBookOcrComplete(book.id);
      }
      // Fire-and-forget the external-storage push so the "finished" state
      // can flip immediately and the user can hit "应用并刷新" without
      // waiting on disk I/O.
      pushOcrResultToExternalStorage(merged).catch(() => {});
      _store.update((s) =>
        s ? { ...s, status: 'finished', failedPages, firstFailure } : s
      );
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? '已中止' : err?.message || String(err);
      _store.update((s) => (s ? { ...s, status: 'errored', error: msg } : s));
    } finally {
      abortCtrl = undefined;
      // Whole-book OCR is the heavyweight path: PaddleOCR keeps the det/rec
      // models plus the ORT WASM heap resident for the rest of the session
      // otherwise. Re-init afterwards measured ~1.3s (models stay in the HTTP
      // cache, so nothing re-downloads). Single-page OCR deliberately does
      // NOT dispose — paying that on every right-click isn't worth it.
      disposeOcrWorker().catch(() => {});
    }
  })();

  return true;
}

export function abortOcrJob() {
  abortCtrl?.abort();
}

/** Clear the visible job state — used after the user has reloaded the
 * book and applied the result, or just dismissed an error. Does NOT
 * abort an in-flight job; call abortOcrJob() first for that. */
export function clearOcrJob() {
  _store.set(null);
}
