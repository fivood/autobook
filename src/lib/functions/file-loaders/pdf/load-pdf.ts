/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * PDF loader (MVP). Uses PDF.js to extract text from each page and stitches
 * it into the same HTML-based LoadData shape that epub/mobi produce, so the
 * existing reader, TTS, bookmarks and statistics pipeline all work without
 * a separate PDF-only UI.
 *
 * Trade-off: layout fidelity is lost — multi-column PDFs flow as single
 * column, image positions don't survive. Reflowable text PDFs (novels,
 * articles) render fine. A future pass can add a faithful canvas-render
 * mode behind a toggle.
 */
import type { LoadData } from '$lib/functions/file-loaders/types';
import type { Section } from '$lib/data/database/books-db/versions/books-db';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';

type PdfjsBundle = {
  pdfjs: typeof import('pdfjs-dist');
  cmapUrl: string;
  standardFontDataUrl: string;
  wasmUrl: string;
};
let pdfjsPromise: Promise<PdfjsBundle> | null = null;
function loadPdfjs(): Promise<PdfjsBundle> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, workerModule, cmapModule, fontModule, wasmModule] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.mjs?url'),
        import('pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap?url'),
        import('pdfjs-dist/standard_fonts/FoxitFixed.pfb?url'),
        import('pdfjs-dist/wasm/jbig2.wasm?url')
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      const cmapUrl = cmapModule.default.replace(/\/[^/]+$/, '/');
      const standardFontDataUrl = fontModule.default.replace(/\/[^/]+$/, '/');
      const wasmUrl = wasmModule.default.replace(/\/[^/]+$/, '/');
      return { pdfjs, cmapUrl, standardFontDataUrl, wasmUrl };
    })();
  }
  return pdfjsPromise;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** PDF.js gives us a list of text items per page with absolute coords. We
 * group items into lines by y-coordinate (within a small tolerance), then
 * group lines into paragraphs by vertical gap. */
function itemsToParagraphs(items: any[]): string[] {
  if (!items.length) return [];

  type Item = { str: string; x: number; y: number; h: number; hasEol: boolean };
  const enriched: Item[] = items
    .filter((it) => typeof it.str === 'string')
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      h: it.height || 0,
      hasEol: !!it.hasEOL
    }));
  if (!enriched.length) return [];

  // Sort top-down, left-to-right. PDF y origin is bottom — bigger y = higher.
  enriched.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });

  type Line = { y: number; text: string };
  const lines: Line[] = [];
  let cur: Line | null = null;
  let lastX = 0;
  for (const it of enriched) {
    if (!cur || Math.abs(cur.y - it.y) > 2) {
      if (cur) lines.push(cur);
      cur = { y: it.y, text: it.str };
      lastX = it.x + (it.str.length * (it.h || 5)) * 0.4;
      continue;
    }
    // Same line — decide whether a space is needed between items.
    const needsSpace =
      it.x - lastX > (it.h || 5) * 0.3 && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
    cur.text += (needsSpace ? ' ' : '') + it.str;
    lastX = it.x + (it.str.length * (it.h || 5)) * 0.4;
  }
  if (cur) lines.push(cur);

  // Group lines into paragraphs by vertical gap. Median line height = unit.
  const heights = enriched.map((it) => it.h).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 12;
  const paraGap = medianH * 1.6;

  const paragraphs: string[] = [];
  let para = '';
  let lastY = lines[0]?.y ?? 0;
  for (const line of lines) {
    if (para && lastY - line.y > paraGap) {
      paragraphs.push(para);
      para = line.text;
    } else if (para) {
      // Join hyphenated word break, else add space.
      if (/-$/.test(para) && /^[a-z]/.test(line.text)) {
        para = para.replace(/-$/, '') + line.text;
      } else {
        para += ' ' + line.text;
      }
    } else {
      para = line.text;
    }
    lastY = line.y;
  }
  if (para) paragraphs.push(para);

  return paragraphs
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

async function renderPageToBlob(
  page: any,
  targetWidth: number,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.85
): Promise<Blob | undefined> {
  try {
    const viewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / viewport.width;
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;

    // Detect blank canvas: sample several spots across the page. If ALL are
    // pure white the render likely failed silently.
    const spots = [
      [0.5, 0.3], [0.5, 0.5], [0.5, 0.7],
      [0.3, 0.5], [0.7, 0.5],
      [0.25, 0.25], [0.75, 0.75]
    ];
    let hasContent = false;
    for (const [fx, fy] of spots) {
      const sx = Math.floor(canvas.width * fx);
      const sy = Math.floor(canvas.height * fy);
      const sw = Math.min(20, canvas.width - sx);
      const sh = Math.min(20, canvas.height - sy);
      if (sw <= 0 || sh <= 0) continue;
      const sample = ctx.getImageData(sx, sy, sw, sh);
      for (let i = 0; i < sample.data.length; i += 4) {
        if (sample.data[i] < 250 || sample.data[i + 1] < 250 || sample.data[i + 2] < 250) {
          hasContent = true;
          break;
        }
      }
      if (hasContent) break;
    }
    if (!hasContent) return undefined;

    const blob = await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((b) => resolve(b || undefined), format, quality);
    });
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } catch {
    return undefined;
  }
}

/** Extract the largest embedded image from a page directly, bypassing canvas
 * rendering. Works well for scanned PDFs where each page is a single image. */
async function extractPageImage(page: any): Promise<Blob | undefined> {
  try {
    const ops = await page.getOperatorList();
    const OPS_PAINT_IMAGE = 85; // OPS.paintImageXObject

    let bestObjId: string | null = null;
    let bestArea = 0;

    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === OPS_PAINT_IMAGE) {
        const objId = ops.argsArray[i][0];
        if (objId && !bestObjId) bestObjId = objId;
        // We could compare sizes, but for scanned PDFs there's usually one
        // dominant image per page. Pick the first one found.
        if (objId) {
          bestObjId = objId;
          break;
        }
      }
    }

    if (!bestObjId) return undefined;

    const imgData: any = await new Promise((resolve, reject) => {
      page.objs.get(bestObjId!, resolve);
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    if (!imgData) return undefined;

    // imgData can be {bitmap: ImageBitmap} or {data: Uint8ClampedArray, width, height}
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    if (imgData.bitmap) {
      canvas.width = imgData.bitmap.width;
      canvas.height = imgData.bitmap.height;
      ctx.drawImage(imgData.bitmap, 0, 0);
    } else if (imgData.data && imgData.width && imgData.height) {
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      const imageData = new ImageData(
        new Uint8ClampedArray(imgData.data),
        imgData.width,
        imgData.height
      );
      ctx.putImageData(imageData, 0, 0);
    } else {
      return undefined;
    }

    const blob = await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob((b) => resolve(b || undefined), 'image/jpeg', 0.85);
    });
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } catch {
    return undefined;
  }
}

const IMAGE_RENDER_WIDTH = 900;
const SCANNED_THRESHOLD = 20;

/** Heuristic: if extracted text is mostly replacement chars, control chars,
 * or lacks any CJK / Latin letter content, it's likely a glyph-mapped PDF
 * without a proper ToUnicode table — treat it as a scanned page. */
function isGarbageText(text: string): boolean {
  if (text.length < SCANNED_THRESHOLD) return true;
  // Count "meaningful" characters: CJK, Latin letters, common punctuation
  const meaningful = text.replace(/[\s\x00-\x1f�]/g, '');
  if (meaningful.length < 5) return true;
  const letterish = meaningful.replace(/[^一-鿿㐀-䶿豈-﫿a-zA-Z0-9　-〿＀-￯]/g, '');
  return letterish.length / meaningful.length < 0.3;
}

export default async function loadPdf(file: File, lastBookModified: number): Promise<LoadData> {
  try {
    return await loadPdfInner(file, lastBookModified);
  } catch (e: any) {
    const msg = e?.message || e?.name || (typeof e === 'string' ? e : JSON.stringify(e));
    throw new Error(`PDF 加载失败: ${msg}`);
  }
}

async function loadPdfInner(file: File, lastBookModified: number): Promise<LoadData> {
  const { pdfjs: pdfjsLib, cmapUrl, standardFontDataUrl, wasmUrl } = await loadPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: cmapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    wasmUrl,
    isOffscreenCanvasSupported: false,
    useSystemFonts: true
  }).promise;

  let title = file.name.replace(/\.pdf$/i, '');
  try {
    const meta: any = await doc.getMetadata();
    const metaTitle = meta?.info?.Title;
    if (typeof metaTitle === 'string' && metaTitle.trim()) {
      title = metaTitle.replace(/\x00/g, '').trim();
    }
  } catch {
    // fall back to filename
  }

  // Pre-scan: sample a few pages to decide text vs image mode.
  // This avoids rendering every page to image for text-rich PDFs.
  const sampleIndices = [1];
  const step = Math.max(1, Math.floor(doc.numPages / 5));
  for (let i = step; i <= doc.numPages; i += step) {
    if (!sampleIndices.includes(i)) sampleIndices.push(i);
  }
  if (!sampleIndices.includes(doc.numPages)) sampleIndices.push(doc.numPages);

  let goodTextPages = 0;
  for (const idx of sampleIndices) {
    const page = await doc.getPage(idx);
    const tc = await page.getTextContent();
    const text = itemsToParagraphs(tc.items as any[]).join('');
    if (!isGarbageText(text)) goodTextPages++;
    page.cleanup();
  }
  const useTextMode = goodTextPages >= sampleIndices.length * 0.5;

  // Cover thumbnail (always render page 1)
  let coverImage: Blob | undefined;
  {
    const coverPage = await doc.getPage(1);
    coverImage = await renderPageToBlob(coverPage, 240);
    coverPage.cleanup();
  }

  // Try to surface the publisher-supplied outline (PDF bookmarks) instead of
  // a flat "Page N" list. We walk getOutline() recursively, resolve each
  // entry's destination to a page number, and build a Map<pageNum, label>
  // covering exactly the pages that ARE bookmarked. Pages without a
  // bookmark fall back to "第 N 页".
  const outlineLabels = new Map<number, string>();
  try {
    const rawOutline: any[] = (await (doc as any).getOutline?.()) || [];
    if (rawOutline.length) {
      const visit = async (items: any[], depth: number) => {
        for (const item of items) {
          const title = String(item?.title || '').trim();
          if (title && item?.dest) {
            try {
              const dest = Array.isArray(item.dest) ? item.dest : await doc.getDestination(item.dest);
              if (Array.isArray(dest) && dest[0]) {
                const pageIndex = await doc.getPageIndex(dest[0]);
                const pageNum = pageIndex + 1;
                if (!outlineLabels.has(pageNum)) {
                  outlineLabels.set(pageNum, depth > 0 ? '  '.repeat(depth) + title : title);
                }
              }
            } catch {
              // skip un-resolvable destinations
            }
          }
          if (item?.items?.length) {
            await visit(item.items, depth + 1);
          }
        }
      };
      await visit(rawOutline, 0);
    }
  } catch {
    // PDF has no outline — fine, we'll use "第 N 页"
  }

  // Main pass
  const sections: Section[] = [];
  const htmlParts: string[] = [];
  const blobs: Record<string, Blob> = {};
  let totalChars = 0;
  let hasAnyImage = false;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const id = `pdf-page-${pageNum}`;
    let bodyHtml: string;
    let sectionChars: number;

    if (useTextMode) {
      // Text mode: extract text only, no image rendering
      const textContent = await page.getTextContent();
      const paragraphs = itemsToParagraphs(textContent.items as any[]);
      const chars = Array.from(paragraphs.join('')).length;
      bodyHtml = paragraphs.length
        ? paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
        : '<p>&nbsp;</p>';
      sectionChars = chars;
    } else {
      // Image mode: render page to image
      let imgBlob = await renderPageToBlob(page, IMAGE_RENDER_WIDTH, 'image/jpeg', 0.82);
      if (!imgBlob) {
        const freshPage = await doc.getPage(pageNum);
        imgBlob = await extractPageImage(freshPage);
        freshPage.cleanup();
      }
      if (imgBlob) {
        const blobName = `pdf-page-${pageNum}.jpg`;
        blobs[blobName] = imgBlob;
        const dummySrc = buildDummyBookImage(blobName);
        bodyHtml = `<img src="${dummySrc}" alt="第 ${pageNum} 页" class="pdf-page-img" data-pdf-page="${pageNum}" style="max-width:100%;height:auto;" />`;
        sectionChars = 1;
        hasAnyImage = true;
      } else {
        bodyHtml = '<p>&nbsp;</p>';
        sectionChars = 0;
      }
    }

    htmlParts.push(
      `<div id="${id}" class="pdf-section"><h3 class="pdf-page-label">${pageNum}</h3>${bodyHtml}</div>`
    );
    const outlineTitle = outlineLabels.get(pageNum);
    sections.push({
      reference: id,
      charactersWeight: sectionChars || 1,
      label: outlineTitle ? `${outlineTitle} · 第 ${pageNum} 页` : `第 ${pageNum} 页`,
      startCharacter: totalChars,
      characters: sectionChars
    });
    totalChars += sectionChars;

    page.cleanup();
  }

  await doc.cleanup();
  await (doc as any).destroy?.();

  const textStyle =
    '.pdf-section { margin-bottom: 2em; } .pdf-page-label { opacity: 0.4; font-size: 0.8em; margin: 1.5em 0 0.5em; } .pdf-section p { text-indent: 2em; margin: 0.5em 0; }';
  const imageStyle =
    '.pdf-section { margin-bottom: 1em; text-align: center; } .pdf-page-label { opacity: 0.4; font-size: 0.8em; margin: 1em 0 0.3em; }';

  return {
    title,
    language: 'zh',
    styleSheet: hasAnyImage ? imageStyle : textStyle,
    elementHtml: htmlParts.join('\n'),
    blobs,
    coverImage,
    hasThumb: !!coverImage,
    characters: totalChars,
    sections,
    lastBookModified,
    lastBookOpen: 0
  };
}
