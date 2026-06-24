/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Orchestrates OCR over an entire PDF book that was previously loaded in
 * "image mode" (scan / pure-image PDF). For each page section, finds the
 * page-image blob in bookdata.blobs, runs Tesseract, and prepends a <p>
 * containing the recognized text before the <img>. The result is saved
 * back into the `data` store so the reader picks it up on the next load.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { ocrImageBlob, type OcrLanguage } from './pdf-ocr';

export interface OcrProgress {
  page: number;
  total: number;
  /** Just-recognized text for this page (best-effort preview). */
  text: string;
}

/** Heuristic: is this book a scanned PDF that hasn't been OCRed yet?
 *
 * Counts real prose, not the per-page label numbers ("1", "2", "3"...) the
 * loader injects as <h3 class="pdf-page-label">. Without this exclusion a
 * 100-page image-only book has ~290 plaintext chars just from the labels
 * and the OCR banner never appears. We also skip the OCR text we
 * previously inserted so the second pass doesn't think the book is
 * already done.
 */
export function isScannedPdf(book: Pick<BooksDbBookData, 'elementHtml'>): boolean {
  const html = book.elementHtml || '';
  const imgCount = (html.match(/data-pdf-page=/g) || []).length;
  if (imgCount === 0) return false;
  const realText = html
    .replace(/<h3[^>]*class="pdf-page-label"[^>]*>[^<]*<\/h3>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, '');
  // Fewer than ~50 chars of real prose per page = scan that needs OCR.
  return realText.length / imgCount < 50;
}

export async function runOcr(
  book: BooksDbBookData,
  lang: OcrLanguage,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal
): Promise<BooksDbBookData> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(book.elementHtml, 'text/html');
  // Iterate by image directly instead of by .pdf-section wrapper — a few
  // edge cases (escaped attributes, very long HTML, malformed markup) make
  // querySelectorAll('.pdf-section') under-count when DOMParser silently
  // drops parents but keeps the imgs.
  const imgs = Array.from(doc.querySelectorAll('img[data-pdf-page]')) as HTMLImageElement[];
  const total = imgs.length;

  for (let i = 0; i < imgs.length; i++) {
    if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');

    const img = imgs[i];
    const pageMarker = img.getAttribute('data-pdf-page') || String(i + 1);
    const pageNum = Number(pageMarker) || i + 1;

    // Insertion target: the nearest containing section, or the image's
    // parent as a fallback.
    const section =
      (img.closest('.pdf-section, .cbz-section') as HTMLElement | null) ||
      (img.parentElement as HTMLElement | null);
    if (!section) continue;

    if (section.querySelector('p.pdf-ocr-text')) {
      onProgress({ page: pageNum, total, text: '' });
      continue;
    }

    // The img src was rewritten to a blob: URL at runtime by
    // format-book-data-html when the book was loaded. We operate on the
    // raw blob from book.blobs by name. The blob is stored under
    // "pdf-page-N.jpg" / "cbz-page-N.jpg".
    const blob =
      book.blobs[`pdf-page-${pageMarker}.jpg`] ||
      book.blobs[`pdf-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.jpg`] ||
      book.blobs[`cbz-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.webp`];
    if (!blob) {
      // eslint-disable-next-line no-console
      console.warn(`[ocr] no blob for page ${pageMarker}`);
      onProgress({ page: pageNum, total, text: '' });
      continue;
    }

    let recognized = '';
    try {
      recognized = await ocrImageBlob(blob, lang);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[ocr] page ${pageNum} failed`, err);
    }

    if (recognized) {
      const paragraphs = recognized
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const html = paragraphs
        .map((p) => `<p class="pdf-ocr-text">${escapeHtml(p)}</p>`)
        .join('\n');
      const wrapper = doc.createElement('div');
      wrapper.innerHTML = html;
      while (wrapper.firstChild) section.insertBefore(wrapper.firstChild, img);
    }

    onProgress({ page: pageNum, total, text: recognized });
  }

  const newHtml = doc.body.innerHTML;
  const newCharacters = newHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

  return {
    ...book,
    elementHtml: newHtml,
    characters: newCharacters,
    lastBookModified: Date.now()
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
