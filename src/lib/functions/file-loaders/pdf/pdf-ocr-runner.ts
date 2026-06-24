/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Orchestrates OCR over an entire PDF book that was previously loaded in
 * "image mode" (scan / pure-image PDF). For each page image, runs Tesseract
 * and inserts a <p> containing the recognized text before the <img>. The
 * result is saved back into the `data` store so the reader picks it up on
 * the next load.
 *
 * IMPORTANT: We deliberately do NOT use DOMParser on the full elementHtml.
 * That worked fine on small books but on 800+ page PDFs we hit a silent
 * truncation issue in the browser's HTML parser — the resulting Document
 * would have a tiny fraction of the original sections, and re-serializing
 * back to innerHTML would replace the stored book with the truncated
 * version. The structure of an image-mode PDF page is regular enough that
 * a string-level rewrite is both faster and lossless.
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
export function isScannedPdf(book: Pick<BooksDbBookData, 'elementHtml' | 'sections'>): boolean {
  const html = book.elementHtml || '';
  const imgCount = countPageImages(html);
  if (imgCount === 0) return false;

  // Already OCR'd: the runner injects <p class="pdf-ocr-text"> before every
  // recognized image. Presence of ANY such marker means the user already
  // ran OCR on this book — don't re-prompt even if recognition was poor
  // and the per-page text density is still low (text-density heuristic
  // can't tell "scanned but never OCR'd" from "scanned, OCR ran but model
  // returned mostly empty results because of bad scan quality").
  if (/<p\s+class="pdf-ocr-text"/.test(html)) return false;

  // Mixed-mode PDFs: PDF.js extracted text for most pages, only a handful
  // of pages fell back to image rendering (typical for books with scanned
  // illustration plates inside an otherwise text PDF). Those embedded
  // images are NOT what OCR is for — running OCR over 19 plate pages in a
  // 289-section book would offer no reading value and trigger the
  // section-count safety guard. Require image pages to dominate the book
  // before we consider it "scanned".
  const sectionCount = book.sections?.length || imgCount;
  if (imgCount / sectionCount < 0.6) return false;

  const realText = stripStructuralText(html);
  return realText.length / imgCount < 50;
}

function countPageImages(html: string): number {
  return (html.match(/data-pdf-page=/g) || []).length;
}

function stripStructuralText(html: string): string {
  return html
    .replace(/<h3[^>]*class="pdf-page-label"[^>]*>[^<]*<\/h3>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface PageMatch {
  /** Full `<img ... />` tag text. */
  imgTag: string;
  /** Offset in the source string where the img tag starts. */
  start: number;
  /** Offset right after the img tag ends. */
  end: number;
  pageNum: number;
  /** Whether this img already has OCR text inserted before it. */
  hasOcr: boolean;
}

function findPageImages(html: string): PageMatch[] {
  // Match an <img> tag carrying data-pdf-page="N". Tags from our loader
  // include a self-closing slash; allow either form.
  const re = /<img\b[^>]*?\bdata-pdf-page="(\d+)"[^>]*?\/?>/g;
  const result: PageMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const pageNum = Number(m[1]);
    // Look backwards a few hundred chars for an existing OCR insertion
    // (a <p class="pdf-ocr-text">) belonging to the same section.
    const lookback = html.slice(Math.max(0, start - 800), start);
    const hasOcr = /<p\s+class="pdf-ocr-text"/.test(lookback);
    result.push({ imgTag: m[0], start, end, pageNum, hasOcr });
  }
  return result;
}

/**
 * Re-run OCR on a single page and write the result back, replacing any
 * existing <p class="pdf-ocr-text"> blocks that immediately precede this
 * page's <img data-pdf-page>. Used by the in-reader "re-OCR this page"
 * context menu so users can fix low-quality pages individually instead
 * of re-running the entire book.
 *
 * Returns the updated BooksDbBookData. Caller is responsible for db.put
 * and reload.
 */
export async function runOcrOnPage(
  book: BooksDbBookData,
  pageNum: number,
  lang: OcrLanguage
): Promise<{ updated: BooksDbBookData; recognized: string }> {
  const html = book.elementHtml;
  const pages = findPageImages(html);
  const target = pages.find((p) => p.pageNum === pageNum);
  if (!target) {
    throw new Error(`OCR 中止：在书中未找到第 ${pageNum} 页的图片标记。`);
  }

  const pageMarker = String(pageNum);
  const blob =
    book.blobs[`pdf-page-${pageMarker}.jpg`] ||
    book.blobs[`pdf-page-${pageMarker}.png`] ||
    book.blobs[`cbz-page-${pageMarker}.jpg`] ||
    book.blobs[`cbz-page-${pageMarker}.png`] ||
    book.blobs[`cbz-page-${pageMarker}.webp`];
  if (!blob) {
    throw new Error(`OCR 中止：找不到第 ${pageNum} 页的原图数据。`);
  }

  const recognized = await ocrImageBlob(blob, lang);

  // Replace the OCR block immediately preceding the target img. We look
  // back at most 50KB (handles very long previous OCR insertions safely)
  // and remove any contiguous run of `<p class="pdf-ocr-text">...</p>`
  // that ends right before this img.
  const lookbackStart = Math.max(0, target.start - 50_000);
  const before = html.slice(lookbackStart, target.start);
  const oldOcrBlock = /(?:<p\s+class="pdf-ocr-text">[\s\S]*?<\/p>\s*)+$/.exec(before);
  const trimEnd = oldOcrBlock ? target.start - oldOcrBlock[0].length : target.start;

  const paragraphs = recognized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const ocrHtml = paragraphs.length
    ? paragraphs.map((p) => `<p class="pdf-ocr-text">${escapeHtml(p)}</p>`).join('\n')
    : '';

  const newHtml =
    html.slice(0, trimEnd) +
    ocrHtml +
    html.slice(target.start);

  // Sanity: every original image marker must still be present.
  const newPageCount = countPageImages(newHtml);
  const originalPageCount = countPageImages(html);
  if (newPageCount !== originalPageCount) {
    throw new Error(
      `OCR 中止：单页重写后页数变化 (${originalPageCount} → ${newPageCount})，未保存。`
    );
  }

  const newCharacters = newHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

  return {
    updated: {
      ...book,
      elementHtml: newHtml,
      characters: newCharacters,
      lastBookModified: Date.now()
    },
    recognized
  };
}

export async function runOcr(
  book: BooksDbBookData,
  lang: OcrLanguage,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal
): Promise<BooksDbBookData> {
  const original = book.elementHtml;
  const pages = findPageImages(original);
  const total = pages.length;

  if (!total) {
    throw new Error('OCR 中止：未找到任何带 data-pdf-page 的图片，可能不是 image 模式 PDF。');
  }

  // Catastrophic-truncation guard: hard floor only. Mixed-mode PDFs can
  // legitimately have <img data-pdf-page> on a small minority of sections
  // (illustration plates inside an otherwise text-extracted book) — the
  // earlier `total < expected * 0.9` rule fired on those legitimate cases
  // even though there was nothing to recover. The post-write check below
  // (newPageCount >= total) still catches actual page-loss during
  // serialization, so this guard only needs to detect "this book is so
  // gutted there are basically no images left to process."
  const expected = book.sections?.length || total;
  if (expected > 100 && total < 5) {
    throw new Error(
      `OCR 中止：只在 ${expected} 节的书里找到 ${total} 个图片页，` +
        '与目录差距过大。可能这本书在更早版本里已经被截断，请删除后重新导入原 PDF。'
    );
  }

  // Build the new HTML by walking the page matches in order, inserting
  // recognized text before each img. Chunks of original HTML between
  // matches pass through verbatim, so nothing outside the OCR insertions
  // is touched.
  const chunks: string[] = [];
  let cursor = 0;

  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');

    const page = pages[i];
    // Append the chunk between the previous insertion point and this img.
    chunks.push(original.slice(cursor, page.start));

    if (page.hasOcr) {
      onProgress({ page: page.pageNum, total, text: '' });
      // No insertion needed; just emit the original img tag.
      chunks.push(page.imgTag);
      cursor = page.end;
      continue;
    }

    const pageMarker = String(page.pageNum);
    const blob =
      book.blobs[`pdf-page-${pageMarker}.jpg`] ||
      book.blobs[`pdf-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.jpg`] ||
      book.blobs[`cbz-page-${pageMarker}.png`] ||
      book.blobs[`cbz-page-${pageMarker}.webp`];

    if (!blob) {
      // eslint-disable-next-line no-console
      console.warn(`[ocr] no blob for page ${pageMarker}`);
      onProgress({ page: page.pageNum, total, text: '' });
      chunks.push(page.imgTag);
      cursor = page.end;
      continue;
    }

    let recognized = '';
    try {
      recognized = await ocrImageBlob(blob, lang);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[ocr] page ${page.pageNum} failed`, err);
    }

    if (recognized) {
      const paragraphs = recognized
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const ocrHtml = paragraphs
        .map((p) => `<p class="pdf-ocr-text">${escapeHtml(p)}</p>`)
        .join('\n');
      chunks.push(ocrHtml);
      chunks.push(page.imgTag);
    } else {
      chunks.push(page.imgTag);
    }

    cursor = page.end;
    onProgress({ page: page.pageNum, total, text: recognized });
  }

  // Append the tail (everything after the last img).
  chunks.push(original.slice(cursor));
  const newHtml = chunks.join('');

  // Final defensive check: the new HTML must still contain every page image
  // we started with. If not, something went wrong and we won't save.
  const newPageCount = countPageImages(newHtml);
  if (newPageCount < total) {
    throw new Error(
      `OCR 中止：序列化丢失了页面 (${newPageCount}/${total})，不保存以避免损坏。`
    );
  }

  const newCharacters = newHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

  return {
    ...book,
    elementHtml: newHtml,
    characters: newCharacters,
    lastBookModified: Date.now()
  };
}
