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

/** Heuristic: is this book a scanned PDF that hasn't been OCRed yet? */
export function isScannedPdf(book: Pick<BooksDbBookData, 'elementHtml'>): boolean {
  const html = book.elementHtml || '';
  if (!html.includes('data-pdf-page=')) return false;
  // Strip all tags and count plaintext chars; mostly-blank means no real text.
  const text = html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ');
  return text.replace(/\s+/g, '').length < 200;
}

export async function runOcr(
  book: BooksDbBookData,
  lang: OcrLanguage,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal
): Promise<BooksDbBookData> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(book.elementHtml, 'text/html');
  const sections = Array.from(doc.querySelectorAll('.pdf-section, .cbz-section')) as HTMLElement[];
  const total = sections.length;

  for (let i = 0; i < sections.length; i++) {
    if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');

    const section = sections[i];
    const pageNum = i + 1;

    if (section.querySelector('p.pdf-ocr-text')) {
      // Already OCR'd in a previous run — keep it.
      continue;
    }

    const img = section.querySelector<HTMLImageElement>('img[data-pdf-page]');
    if (!img) continue;

    // The img src was rewritten to a blob: URL at runtime by
    // format-book-data-html when the book was loaded. When we run OCR we
    // operate on the raw blob from book.blobs by name. The blob is stored
    // under a name like "pdf-page-N.jpg" / "cbz-page-N.jpg".
    const pageMarker = img.getAttribute('data-pdf-page') || String(pageNum);
    const blob =
      book.blobs[`pdf-page-${pageMarker}.jpg`] ||
      book.blobs[`pdf-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.jpg`] ||
      book.blobs[`cbz-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.webp`];
    if (!blob) {
      onProgress({ page: pageNum, total, text: '' });
      continue;
    }

    let recognized = '';
    try {
      recognized = await ocrImageBlob(blob, lang);
    } catch (err) {
      // Skip page on failure but keep going.
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
      // Insert OCR text BEFORE the image so reading order is text-then-image.
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
