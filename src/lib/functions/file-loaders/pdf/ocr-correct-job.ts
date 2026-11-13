/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Singleton runner for OCR post-correction, following the same shape as
 * ocr-job-manager: module-level state so navigating away doesn't kill the
 * job, one job at a time, abortable.
 *
 * One at a time is not arbitrary here either — a local model holds the whole
 * runtime's GPU memory, so a second concurrent job would halve throughput on
 * both rather than finish anything sooner.
 *
 * This is the first batch LLM task in the app. It deliberately reuses the OCR
 * job's structure rather than inventing a generic job framework: two jobs is
 * not enough evidence to know what the abstraction should be. If a third
 * batch task lands and the copied structure still fits, that is the moment to
 * extract it.
 */

import { writable, type Readable } from 'svelte/store';
import { database } from '$lib/data/store';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { chatOnce, type AiClientOpts } from '$lib/data/ai/ai-client';
import {
  applyOcrCorrections,
  batchOcrLines,
  buildCorrectionSystemPrompt,
  buildCorrectionUserPrompt,
  extractOcrLines,
  isPlausibleCorrection,
  parseCorrectionResponse
} from './ocr-correct';

export type OcrCorrectStatus = 'running' | 'finished' | 'errored';

export interface OcrCorrectProgress {
  batch: number;
  totalBatches: number;
  linesCorrected: number;
  totalLines: number;
}

export interface OcrCorrectJobState {
  bookId: number;
  bookTitle: string;
  modelId: string;
  status: OcrCorrectStatus;
  progress: OcrCorrectProgress;
  /** Batches the model failed or returned nothing usable for. */
  failedBatches: number;
  error?: string;
  startedAt: number;
}

let abortCtrl: AbortController | undefined;
const _store = writable<OcrCorrectJobState | null>(null);

export const ocrCorrectJob$: Readable<OcrCorrectJobState | null> = _store;

export function isOcrCorrectJobRunning(): boolean {
  return !!abortCtrl;
}

export function abortOcrCorrectJob() {
  abortCtrl?.abort();
}

export function clearOcrCorrectJob() {
  _store.set(null);
}

/** True when the book has a text layer worth correcting. */
export function hasCorrectableText(book: Pick<BooksDbBookData, 'elementHtml'>): boolean {
  return /class="pdf-text-layer"/.test(book.elementHtml || '');
}

export function startOcrCorrectJob(book: BooksDbBookData, opts: AiClientOpts): boolean {
  if (abortCtrl) return false;

  const lines = extractOcrLines(book.elementHtml || '');
  if (!lines.length) return false;

  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  const batches = batchOcrLines(lines);

  _store.set({
    bookId: book.id,
    bookTitle: book.title,
    modelId: opts.model,
    status: 'running',
    progress: { batch: 0, totalBatches: batches.length, linesCorrected: 0, totalLines: lines.length },
    failedBatches: 0,
    startedAt: Date.now()
  });

  (async () => {
    const corrections = new Map<number, string>();
    const sourceById = new Map(lines.map((line) => [line.index, line.text]));
    let failedBatches = 0;

    try {
      for (let i = 0; i < batches.length; i += 1) {
        if (signal.aborted) break;
        const batch = batches[i];
        if (!batch) continue;

        try {
          const raw = await chatOnce(opts, {
            system: buildCorrectionSystemPrompt(),
            messages: [{ role: 'user', content: buildCorrectionUserPrompt(batch) }],
            maxTokens: 2048,
            jsonMode: true,
            signal
          });
          const parsed = parseCorrectionResponse(raw, batch);
          for (const [id, corrected] of parsed) {
            const original = sourceById.get(id);
            // Length-ratio guard: a "correction" far from the source is a
            // rewrite, not a fix. Dropping it costs one uncorrected line.
            if (original && isPlausibleCorrection(original, corrected)) {
              corrections.set(id, corrected);
            }
          }
          if (!parsed.size) failedBatches += 1;
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          // A single bad batch must not sink the run — the remaining pages
          // are still worth correcting, and untouched lines keep OCR text.
          failedBatches += 1;
        }

        _store.update((s) =>
          s
            ? {
                ...s,
                failedBatches,
                progress: {
                  ...s.progress,
                  batch: i + 1,
                  linesCorrected: corrections.size
                }
              }
            : s
        );
      }

      // Write whatever was gathered, including on abort: a half-corrected
      // text layer is strictly better than none, and the job is re-runnable.
      if (corrections.size) {
        const db = await database.db;
        const fresh = await db.get('data', book.id);
        if (fresh) {
          const { html, applied } = applyOcrCorrections(fresh.elementHtml || '', corrections);
          if (applied) {
            await db.put('data', { ...fresh, elementHtml: html });
          }
          _store.update((s) =>
            s ? { ...s, progress: { ...s.progress, linesCorrected: applied } } : s
          );
        }
      }

      _store.update((s) => (s ? { ...s, status: 'finished', failedBatches } : s));
    } catch (err: any) {
      const aborted = err?.name === 'AbortError' || signal.aborted;
      _store.update((s) =>
        s
          ? {
              ...s,
              status: aborted ? 'finished' : 'errored',
              failedBatches,
              error: aborted ? undefined : err?.message || String(err)
            }
          : s
      );
    } finally {
      abortCtrl = undefined;
    }
  })();

  return true;
}
