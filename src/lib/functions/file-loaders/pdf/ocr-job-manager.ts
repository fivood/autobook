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
import { database } from '$lib/data/store';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { runOcr, type OcrProgress } from './pdf-ocr-runner';
import type { OcrLanguage } from './pdf-ocr';

export type OcrJobStatus = 'running' | 'finished' | 'errored';

export interface OcrJobState {
  bookId: number;
  bookTitle: string;
  lang: OcrLanguage;
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
export function startOcrJob(book: BooksDbBookData, lang: OcrLanguage): boolean {
  if (abortCtrl) return false;
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  _store.set({
    bookId: book.id,
    bookTitle: book.title,
    lang,
    status: 'running',
    progress: { page: 0, total: 0, text: '' },
    startedAt: Date.now()
  });

  (async () => {
    try {
      const updated = await runOcr(
        book,
        lang,
        (p) => {
          _store.update((s) => (s ? { ...s, progress: p } : s));
        },
        signal
      );
      const db = await database.db;
      await db.put('data', updated);
      _store.update((s) => (s ? { ...s, status: 'finished' } : s));
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? '已中止' : err?.message || String(err);
      _store.update((s) => (s ? { ...s, status: 'errored', error: msg } : s));
    } finally {
      abortCtrl = undefined;
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
