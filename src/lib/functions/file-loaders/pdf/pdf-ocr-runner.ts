/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Orchestrates OCR over an entire PDF book that was previously loaded in
 * "image mode" (scan / pure-image PDF). For each page image, runs the
 * PaddleOCR engine and wraps the `<img>` in a `pdf-page-shell` carrying a
 * transparent `pdf-text-layer` of positioned `<span>`s — same shape as
 * 1.11's text-mode PDFs. The result is that scanned books behave like
 * Chrome's PDF viewer: the user sees the original image, but can
 * mouse-select the text under it for copy / dictionary / AI / highlight
 * workflows.
 *
 * IMPORTANT: We deliberately do NOT use DOMParser on the full elementHtml.
 * That worked fine on small books but on 800+ page PDFs we hit a silent
 * truncation issue in the browser's HTML parser — the resulting Document
 * would have a tiny fraction of the original sections, and re-serializing
 * back to innerHTML would replace the stored book with the truncated
 * version. The structure of an image-mode PDF page is regular enough that
 * a string-level rewrite is both faster and lossless.
 *
 * Legacy formats we still recognise on read:
 *   - pre-1.13: `<p class="pdf-ocr-text">…</p>` blocks before each img
 *     (Tesseract paragraph output)
 *   - 1.13: `pdf-page-shell` + `pdf-text-layer` with per-WORD (CJK: per-char)
 *     spans (Tesseract HOCR output)
 *   - 1.14+: `pdf-page-shell` + `pdf-text-layer` with per-LINE spans
 *     (PaddleOCR)
 * All three render the same way thanks to shared CSS; only the bbox
 * granularity differs. Re-OCR upgrades any shape to the newest.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import {
  ocrImageBlob,
  type OcrLanguage,
  type OcrLineItem,
  type OcrModelProfile
} from './pdf-ocr';

export interface OcrProgress {
  page: number;
  total: number;
  /** Just-recognized text for this page (cleaned of CJK-internal spaces). */
  text: string;
}

/** Heuristic: is this book a scanned PDF that hasn't been OCRed yet? */
export function isScannedPdf(book: Pick<BooksDbBookData, 'elementHtml' | 'sections'>): boolean {
  const html = book.elementHtml || '';
  const imgCount = countPageImages(html);
  if (imgCount === 0) return false;

  // Comic archives (CBZ / CBR / CB7 / CBT) emit class="cbz-section" on
  // every page. These are image-by-design books — not "accidentally
  // scanned PDFs" — so the OCR prompt doesn't apply. Power users who do
  // want to OCR manga / Western comics can still trigger it per-page via
  // the page context menu inside the reader.
  if (/class="cbz-section/.test(html)) return false;

  // Already OCR'd: 1.13+ runs wrap each page in a `pdf-page-shell` with a
  // transparent `pdf-text-layer`; legacy runs left a `<p class="pdf-ocr-text">`
  // marker before each img. Either marker means OCR was attempted — don't
  // re-prompt even if recognition was sparse.
  if (/<p\s+class="pdf-ocr-text"|class="pdf-text-layer"/.test(html)) return false;

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
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PageMatch {
  /** Full `<img ... />` tag text. */
  imgTag: string;
  /** Offset where the img tag starts. */
  start: number;
  /** Offset right after the img tag ends. */
  end: number;
  pageNum: number;
  /** Whether this img is already OCR'd in any flavour. */
  hasOcr: boolean;
  /** True only when the new (1.13+) shell + text-layer wrapper is already
   * present. Legacy `<p class="pdf-ocr-text">` blocks set hasOcr but NOT
   * this — full-book OCR uses that distinction to upgrade legacy pages
   * automatically (re-run Tesseract, replace `<p>` with the shell). */
  hasShellOcr: boolean;
  /**
   * If non-null, the chunk preceding this page that we should overwrite
   * starts at this offset (covers a `<div class="pdf-page-shell">` opening
   * or a run of legacy `<p class="pdf-ocr-text">` blocks). When stripping
   * for re-OCR, drop everything from `stripFrom` up to `start`.
   */
  stripFrom?: number;
  /**
   * If non-null, the OCR additions trailing this page (text layer +
   * closing shell `</div>`) end here. When re-OCR'ing, resume copying
   * from this offset instead of `end` so the old layer doesn't leak
   * through. Always >= `end`.
   */
  resumeAt?: number;
}

function findPageImages(html: string): PageMatch[] {
  const re = /<img\b[^>]*?\bdata-pdf-page="(\d+)"[^>]*?\/?>/g;
  const shellOpenRe = /<div\s+class="pdf-page-shell"[^>]*>\s*$/;
  // Match a contiguous run of legacy <p class="pdf-ocr-text">…</p> blocks
  // that ends right at the cursor.
  const legacyParasRe = /(?:<p\s+class="pdf-ocr-text"[^>]*>[\s\S]*?<\/p>\s*)+$/;
  // Forward: `<div class="pdf-text-layer">…</div></div>` immediately after
  // the img. Tolerates whitespace between segments.
  const trailingLayerRe = /^\s*<div\s+class="pdf-text-layer"[^>]*>[\s\S]*?<\/div>\s*<\/div>/;

  const result: PageMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const pageNum = Number(m[1]);

    const lookback = html.slice(Math.max(0, start - 50_000), start);
    const shellMatch = shellOpenRe.exec(lookback);

    let stripFrom: number | undefined;
    let resumeAt: number | undefined;
    let hasOcr = false;
    let hasShellOcr = false;

    if (shellMatch) {
      stripFrom = start - shellMatch[0].length;
      const lookahead = html.slice(end, Math.min(html.length, end + 200_000));
      const trailingMatch = trailingLayerRe.exec(lookahead);
      if (trailingMatch) {
        resumeAt = end + trailingMatch[0].length;
        hasOcr = true;
        hasShellOcr = true;
      }
    } else {
      const legacyMatch = legacyParasRe.exec(lookback);
      if (legacyMatch) {
        stripFrom = start - legacyMatch[0].length;
        hasOcr = true;
      }
    }

    result.push({ imgTag: m[0], start, end, pageNum, hasOcr, hasShellOcr, stripFrom, resumeAt });
  }
  return result;
}

interface TextLayerBuild {
  /** Joined `<span>` markup for the text layer. */
  spans: string;
  /** Total recognized character count (for `book.characters` accounting). */
  charCount: number;
  /** Plain text, CJK-internal spaces collapsed. Used for the banner preview
   * and as a copy-friendly form when the layer can't render. */
  cleanText: string;
}

/**
 * Convert PaddleOCR per-line items into positioned `<span>` markup for
 * a `.pdf-text-layer`. Each item carries a 4-point polygon in image
 * pixel coords; we take the axis-aligned bounding rect (good enough
 * for printed text — skewed scans get a slightly larger box but
 * selection still lands on the right characters thanks to CSS
 * white-space + letter-spacing). One `<span>` per line.
 *
 * The browser splits selection per-character inside a single span, so
 * partial-line copy / highlight still works; the visual selection
 * rectangle is line-tall instead of character-tall, which is a tiny
 * UX cost for a big accuracy win.
 */
function itemsToTextLayer(items: OcrLineItem[]): TextLayerBuild {
  if (!items.length) return { spans: '', charCount: 0, cleanText: '' };
  const out: string[] = [];
  const textParts: string[] = [];
  let chars = 0;

  for (const it of items) {
    const text = it.text?.trim();
    if (!text) continue;
    if (!it.poly || it.poly.length < 3) continue;

    // Paddle polygons are `[x, y]` tuples, NOT `{ x, y }` objects. Reading
    // p.x on a tuple returns undefined, the comparison silently fails,
    // minX stays Infinity, w turns -Infinity, every line gets filtered
    // by the w<=0 guard → empty layer despite 25 valid items.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of it.poly) {
      const px = p[0];
      const py = p[1];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) continue;

    // For multi-character spans, set width to match the source bbox and
    // use letter-spacing to fill it. Pure CJK lines have char width
    // ~= font-size already; this kicks in for mixed CJK+Latin where the
    // narrower Latin chars would otherwise pack to the left and leave
    // the selection drifting off the underlying ink.
    const charCount = [...text].length;
    const naturalWidth = charCount * h;
    const extraSpacing = charCount > 1 ? Math.max(0, (w - naturalWidth) / (charCount - 1)) : 0;
    const letterSpacingAttr = extraSpacing > 0.5 ? `;letter-spacing:${extraSpacing.toFixed(2)}px` : '';

    out.push(
      `<span style="left:${minX}px;top:${minY}px;width:${w}px;font-size:${h}px;white-space:nowrap${letterSpacingAttr}">${escapeHtml(text)}</span>`
    );
    chars += charCount;
    textParts.push(text);
  }

  // Plain-text fallback / preview: lines joined by \n, no extra
  // CJK-space squeezing (Paddle doesn't insert per-char spaces, so
  // unlike Tesseract there's nothing to collapse here).
  const cleanText = textParts.join('\n');

  return { spans: out.join(''), charCount: chars, cleanText };
}

function buildPageShell(
  imgTag: string,
  pageW: number,
  pageH: number,
  spans: string
): string {
  // Empty text layer is still emitted (just `<div class="pdf-text-layer"></div>`)
  // so isScannedPdf and the re-OCR detector both recognize the page as
  // processed even if Tesseract returned nothing.
  return (
    `<div class="pdf-page-shell" data-page-w="${pageW}" data-page-h="${pageH}"` +
    ` style="aspect-ratio: ${pageW} / ${pageH};">` +
    imgTag +
    `<div class="pdf-text-layer" data-page-w="${pageW}" data-page-h="${pageH}">${spans}</div>` +
    `</div>`
  );
}

/**
 * Walk the new HTML, count text content per pdf/cbz section, and produce
 * an updated `sections` array with accurate `characters` and cumulative
 * `startCharacter`. The reader's TTS highlight, scroll-mode bookmark math,
 * and paginated section-jump logic all use these fields; before OCR each
 * section is `characters: 1` (image-mode placeholder) and after OCR the
 * sections suddenly carry hundreds of glyphs, so we have to rewrite the
 * whole array to keep positions accurate.
 *
 * Counts only the OCR span text (and any legacy `<p class="pdf-ocr-text">`
 * content), NOT the `<h3 class="pdf-page-label">N</h3>` page number —
 * that's display chrome, the user doesn't scroll through it.
 */
function recomputeSectionChars(
  html: string,
  sections: BooksDbBookData['sections']
): { sections: BooksDbBookData['sections']; total: number } {
  if (!sections || !sections.length) return { sections, total: 0 };

  // Build an offset → next-section map by scanning section opening tags.
  const sectionOpenRe = /<div\s+id="((?:pdf-page|cbz-page)-\d+)"[^>]*class="[^"]*pdf-section[^"]*"[^>]*>/g;
  const positions: Array<{ id: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = sectionOpenRe.exec(html)) !== null) {
    positions.push({ id: m[1], start: m.index });
  }
  const byId = new Map<string, { start: number; end: number }>();
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : html.length;
    byId.set(positions[i].id, { start: positions[i].start, end });
  }

  let cumulative = 0;
  const updated = sections.map((sec) => {
    const ref = sec.reference || '';
    const pos = byId.get(ref);
    if (!pos) {
      // Section in the array but not in the rendered HTML — keep its
      // existing count, just rebase the offset.
      const out = { ...sec, startCharacter: cumulative };
      cumulative += sec.characters || 0;
      return out;
    }
    const chunk = html.slice(pos.start, pos.end);
    // Drop the page-label `<h3>` content from the count — it's chrome.
    const stripped = chunk
      .replace(/<h3[^>]*class="[^"]*pdf-page-label[^"]*"[^>]*>[\s\S]*?<\/h3>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, '');
    const chars = stripped.length || 1;
    const out = { ...sec, characters: chars, startCharacter: cumulative };
    cumulative += chars;
    return out;
  });

  return { sections: updated, total: cumulative };
}

function pageBlobFromBook(book: BooksDbBookData, pageNum: number): Blob | undefined {
  const m = String(pageNum);
  return (
    book.blobs[`pdf-page-${m}.jpg`] ||
    book.blobs[`pdf-page-${m}.png`] ||
    book.blobs[`cbz-page-${m}.jpg`] ||
    book.blobs[`cbz-page-${m}.png`] ||
    book.blobs[`cbz-page-${m}.webp`]
  );
}

/**
 * Re-run OCR on a single page and write the result back, replacing any
 * existing `<p class="pdf-ocr-text">` blocks OR any prior `pdf-page-shell`
 * wrapper that surrounds this page's `<img data-pdf-page>`. Used by the
 * in-reader "re-OCR this page" context menu so users can fix low-quality
 * pages individually instead of re-running the entire book.
 *
 * Returns the updated BooksDbBookData. Caller is responsible for db.put
 * and reload.
 */
export async function runOcrOnPage(
  book: BooksDbBookData,
  pageNum: number,
  lang: OcrLanguage,
  profile: OcrModelProfile
): Promise<{ updated: BooksDbBookData; recognized: string }> {
  const html = book.elementHtml;
  const pages = findPageImages(html);
  const target = pages.find((p) => p.pageNum === pageNum);
  if (!target) {
    throw new Error(`OCR 中止：在书中未找到第 ${pageNum} 页的图片标记。`);
  }

  const blob = pageBlobFromBook(book, pageNum);
  if (!blob) {
    throw new Error(`OCR 中止：找不到第 ${pageNum} 页的原图数据。`);
  }

  const ocrResult = await ocrImageBlob(blob, lang, profile);
  const layer = itemsToTextLayer(ocrResult.items);
  const wrapped = buildPageShell(
    target.imgTag,
    ocrResult.imageWidth,
    ocrResult.imageHeight,
    layer.spans
  );

  // Strip any prior OCR additions around the img (shell wrapper or legacy
  // `<p class="pdf-ocr-text">` blocks). Fall back to the unmodified
  // boundaries if nothing was detected.
  const trimEnd = target.stripFrom ?? target.start;
  const resumeFrom = target.resumeAt ?? target.end;

  const newHtml = html.slice(0, trimEnd) + wrapped + html.slice(resumeFrom);

  const newPageCount = countPageImages(newHtml);
  const originalPageCount = countPageImages(html);
  if (newPageCount !== originalPageCount) {
    throw new Error(
      `OCR 中止：单页重写后页数变化 (${originalPageCount} → ${newPageCount})，未保存。`
    );
  }

  const { sections: updatedSections, total: newCharacters } = recomputeSectionChars(
    newHtml,
    book.sections
  );

  return {
    updated: {
      ...book,
      elementHtml: newHtml,
      characters: newCharacters,
      sections: updatedSections,
      lastBookModified: Date.now()
    },
    recognized: layer.cleanText
  };
}

/**
 * Fold a finished OCR run into whatever the book row says *now*.
 *
 * A whole-book run takes minutes, and the OCR banner sits on screen for all of
 * them — it can write `ocrLang`, and single-page re-OCR can write
 * `elementHtml`. The job used to write back the book object it captured when
 * it started, silently reverting any of that. Only the four fields the run
 * actually produces come from the result; every other field belongs to the
 * current row.
 */
export function mergeOcrResult<T extends Record<string, any>>(current: T, produced: T): T {
  return {
    ...current,
    elementHtml: produced.elementHtml,
    characters: produced.characters,
    sections: produced.sections,
    lastBookModified: produced.lastBookModified
  };
}

export async function runOcr(
  book: BooksDbBookData,
  lang: OcrLanguage,
  profile: OcrModelProfile,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal
): Promise<{ book: BooksDbBookData; failedPages: number; totalPages: number; firstFailure: string }> {
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
  // still catches actual page-loss during serialization, so this guard
  // only needs to detect "this book is so gutted there are basically no
  // images left to process."
  const expected = book.sections?.length || total;
  if (expected > 100 && total < 5) {
    throw new Error(
      `OCR 中止：只在 ${expected} 节的书里找到 ${total} 个图片页，` +
        '与目录差距过大。可能这本书在更早版本里已经被截断，请删除后重新导入原 PDF。'
    );
  }

  const chunks: string[] = [];
  let cursor = 0;
  /** Pages that produced no text layer. Both bail-outs below used to be a
   *  console.warn and nothing else, so a run where every single page failed
   *  finished exactly like a clean one — and markBookOcrComplete then put the
   *  book on the skip list, retiring the banner that would have let the user
   *  retry. */
  let failedPages = 0;
  let firstFailure = '';

  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw new DOMException('OCR aborted', 'AbortError');

    const page = pages[i];
    const progressPage = i + 1;
    const chunkEnd = page.stripFrom ?? page.start;
    chunks.push(original.slice(cursor, chunkEnd));

    if (page.hasShellOcr) {
      // Page is already in the new shell + text-layer format — copy the
      // existing wrapper through verbatim and advance past it.
      onProgress({ page: progressPage, total, text: '' });
      const copyFrom = page.stripFrom ?? page.start;
      const copyTo = page.resumeAt ?? page.end;
      chunks.push(original.slice(copyFrom, copyTo));
      cursor = copyTo;
      continue;
    }

    // Legacy (`<p class="pdf-ocr-text">…</p>`) or never-OCR'd: fall through
    // to a fresh OCR pass. The legacy <p>s were already excluded from the
    // chunk above via `stripFrom`, so the rebuild cleanly replaces them
    // with the new shell+layer shape.

    const blob = pageBlobFromBook(book, page.pageNum);
    if (!blob) {
      failedPages += 1;
      if (!firstFailure) firstFailure = `第 ${page.pageNum} 页取不到图片数据`;
      console.warn(`[ocr] no blob for page ${page.pageNum}`);
      onProgress({ page: progressPage, total, text: '' });
      chunks.push(page.imgTag);
      cursor = page.end;
      continue;
    }

    let pageW = 0;
    let pageH = 0;
    let cleanText = '';
    let spans = '';
    try {
      const result = await ocrImageBlob(blob, lang, profile);
      pageW = result.imageWidth;
      pageH = result.imageHeight;
      const layer = itemsToTextLayer(result.items);
      spans = layer.spans;
      cleanText = layer.cleanText;
    } catch (err: any) {
      failedPages += 1;
      if (!firstFailure) {
        firstFailure = `第 ${page.pageNum} 页：${err?.message || String(err)}`;
      }
      console.warn(`[ocr] page ${page.pageNum} failed`, err);
    }

    if (pageW > 0 && pageH > 0) {
      // Always emit the shell so the page is marked OCR'd even when the
      // engine returned nothing — text layer just renders empty.
      chunks.push(buildPageShell(page.imgTag, pageW, pageH, spans));
    } else {
      // Dimension probe failed — leave the image unwrapped so we don't
      // create a shell with garbage data-page-w/h that breaks scaling.
      chunks.push(page.imgTag);
    }

    cursor = page.end;
    onProgress({ page: progressPage, total, text: cleanText });
  }

  chunks.push(original.slice(cursor));
  let newHtml = chunks.join('');

  // Always stamp a sentinel so isScannedPdf knows OCR was run, even when
  // every page yielded an empty text layer (low-quality scan, language
  // model mismatch, etc.).
  if (!/<p\s+class="pdf-ocr-text"|class="pdf-text-layer"/.test(newHtml)) {
    newHtml = '<p class="pdf-ocr-text" hidden></p>' + newHtml;
  }

  const newPageCount = countPageImages(newHtml);
  if (newPageCount < total) {
    throw new Error(
      `OCR 中止：序列化丢失了页面 (${newPageCount}/${total})，不保存以避免损坏。`
    );
  }

  const { sections: updatedSections, total: newCharacters } = recomputeSectionChars(
    newHtml,
    book.sections
  );

  return {
    book: {
      ...book,
      elementHtml: newHtml,
      characters: newCharacters,
      sections: updatedSections,
      lastBookModified: Date.now()
    },
    failedPages,
    totalPages: total,
    firstFailure
  };
}
