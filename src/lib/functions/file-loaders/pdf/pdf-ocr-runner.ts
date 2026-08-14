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

import type { BooksDbBookData, Section } from '$lib/data/database/books-db/versions/books-db';
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
  const imgCount = countPageImages(html);
  if (imgCount === 0) return false;
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
  /** Characters of OCR text already present, so a re-run can restate the
   * section table for books OCR'd before it was being maintained. */
  existingOcrChars: number;
}

/** Count the visible characters inside the `<p class="pdf-ocr-text">` blocks
 * of an HTML span, matching how a fresh OCR pass counts what it inserts. */
function countOcrText(html: string): number {
  let total = 0;
  const re = /<p\s+class="pdf-ocr-text"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    total += Array.from(m[1].replace(/<[^>]+>/g, '')).length;
  }
  return total;
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
    // Does this page already carry OCR text? Look only at the span between
    // the previous page image and this one — a fixed-size lookback window
    // either catches the *previous* page's text (and skips this page forever)
    // or misses our own when the last paragraph is long enough to fill it.
    const spanStart = result.length ? result[result.length - 1].end : 0;
    const between = html.slice(spanStart, start);
    const hasOcr = /<p\s+class="pdf-ocr-text"/.test(between);
    result.push({
      imgTag: m[0],
      start,
      end,
      pageNum,
      hasOcr,
      existingOcrChars: hasOcr ? countOcrText(between) : 0
    });
  }
  return result;
}

/** How often to hand the caller a partial result it can persist. */
const CHECKPOINT_EVERY_PAGES = 25;

export async function runOcr(
  book: BooksDbBookData,
  lang: OcrLanguage,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
  onCheckpoint?: (partial: BooksDbBookData) => Promise<void> | void
): Promise<BooksDbBookData> {
  const original = book.elementHtml;
  const pages = findPageImages(original);
  const total = pages.length;

  if (!total) {
    throw new Error('OCR 中止：未找到任何带 data-pdf-page 的图片，可能不是 image 模式 PDF。');
  }

  // Sanity guard against catastrophic truncation. If the runner sees far
  // fewer pages than the book's section count claims, refuse to write back —
  // a previous bug (v1.10.3 used DOMParser on the full HTML and silently
  // dropped sections) damaged some books; this guard makes any recurrence
  // visible rather than silently overwriting.
  const expected = book.sections?.length || total;
  if (expected > 10 && total < expected * 0.9) {
    throw new Error(
      `OCR 中止：找到的页数 (${total}) 远少于书的目录页数 (${expected})。` +
        '可能这本书在更早版本里已经被截断，请删除后重新导入原 PDF。'
    );
  }

  // Build the new HTML by walking the page matches in order, inserting
  // recognized text before each img. Chunks of original HTML between
  // matches pass through verbatim, so nothing outside the OCR insertions
  // is touched.
  const chunks: string[] = [];
  let cursor = 0;
  /** page number → characters the OCR pass added for that page. */
  const charsByPage = new Map<number, number>();

  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');

    const page = pages[i];
    // Append the chunk between the previous insertion point and this img.
    chunks.push(original.slice(cursor, page.start));

    if (page.hasOcr) {
      onProgress({ page: page.pageNum, total, text: '' });
      // No insertion needed; just emit the original img tag.
      chunks.push(page.imgTag);
      charsByPage.set(page.pageNum, page.existingOcrChars);
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
      // Same measure load-pdf uses for text-mode pages: code points of the
      // rendered text, so the recomputed sections stay in one unit system.
      charsByPage.set(page.pageNum, Array.from(paragraphs.join('')).length);
    } else {
      chunks.push(page.imgTag);
    }

    cursor = page.end;
    onProgress({ page: page.pageNum, total, text: recognized });

    // Persist partial work. An 894-page scan runs for hours; losing all of it
    // to a closed window meant starting over, and the runner already skips
    // pages that carry OCR text, so a resumed job picks up where this left off.
    if (onCheckpoint && (i + 1) % CHECKPOINT_EVERY_PAGES === 0 && i + 1 < pages.length) {
      const partialHtml = chunks.join('') + original.slice(cursor);
      await onCheckpoint(buildBook(book, partialHtml, charsByPage));
    }
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

  return buildBook(book, newHtml, charsByPage);
}

/**
 * Assemble the updated record. `characters` is the sum of the sections by
 * construction, the same invariant load-pdf establishes — recomputing it
 * independently is how the two drifted apart before: an image-mode page counts
 * 1 character, so a 900-page scan claimed 900 characters while the top-level
 * count jumped to six figures after OCR, and every progress readout disagreed
 * with the next.
 */
function buildBook(
  book: BooksDbBookData,
  elementHtml: string,
  charsByPage: Map<number, number>
): BooksDbBookData {
  const sections = recomputeSections(book.sections, charsByPage);
  const characters = sections.length
    ? sections.reduce((sum, s) => sum + (s.characters || 0), 0)
    : Array.from(elementHtml.replace(/<[^>]+>/g, '')).length;

  return {
    ...book,
    elementHtml,
    characters,
    sections,
    lastBookModified: Date.now()
  };
}

/**
 * Rebuild the section table against the OCR'd text. Sections keep their
 * reference, label and order — only the character counts and the running
 * `startCharacter` offsets change, since those are what the reader uses to
 * map a scroll position onto a progress number.
 */
function recomputeSections(
  sections: Section[] | undefined,
  charsByPage: Map<number, number>
): Section[] {
  if (!sections?.length) return sections || [];

  let startCharacter = 0;
  return sections.map((section) => {
    const pageNum = pageNumberOf(section.reference);
    const ocrChars = pageNum === undefined ? undefined : charsByPage.get(pageNum);
    // A page we didn't OCR (already done, no blob, empty result) keeps the
    // count it had, so re-running only ever refines the table.
    const characters = ocrChars ?? section.characters ?? 0;
    const next: Section = {
      ...section,
      characters,
      charactersWeight: characters || 1,
      startCharacter
    };
    startCharacter += characters;
    return next;
  });
}

/** Section references are `pdf-page-12` / `cbz-page-12`; pull the number out. */
function pageNumberOf(reference: string | undefined): number | undefined {
  const match = /(\d+)$/.exec(reference || '');
  return match ? Number(match[1]) : undefined;
}
