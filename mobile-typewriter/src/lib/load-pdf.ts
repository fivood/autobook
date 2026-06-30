// PDF loader. Renders each page to a JPEG blob and (when there's a
// text layer) collects positioned span markup so the reader can let
// the user select / copy the text under each scan. Scanned PDFs with
// no embedded text get the image only — no OCR in the PWA, by design.
//
// pdfjs-dist is dynamic-imported the first time, so users who never
// pick a PDF don't pay the ~600KB worker + cmaps cost.

const IMAGE_RENDER_WIDTH = 1200; // pixels — balance of clarity vs memory

export interface PdfPage {
  /** JPEG of the rendered page. ObjectURL is created by the caller on
   * demand so we don't leak when a PDF is closed without reading. */
  imageBlob: Blob;
  /** Intrinsic dimensions in PDF user units (matches the bbox space of
   * the positioned text-layer spans). */
  width: number;
  height: number;
  /** Pre-built `<span>` markup for the transparent text layer. Empty
   * string when the page has no extractable text (scanned). */
  textHtml: string;
  /** Recognized character count on this page. Used for "total chars"
   * accounting but the reader's primary progress is page-based. */
  charCount: number;
}

export interface ParsedPdf {
  kind: 'pdf';
  title: string;
  pages: PdfPage[];
  /** Resized thumbnail of page 1 as a `data:` URL. Used in the recent
   * list and saved alongside the position. */
  coverDataUrl?: string;
  totalChars: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build positioned `<span>` markup from PDF.js text content items. The
 * coordinate space is the page's intrinsic px size; the reader scales
 * the whole layer via `--pdf-scale-factor` so spans always sit on top
 * of the rendered image. Mirrors the desktop autopage's buildTextLayer
 * — same conversion math, same span attributes. */
function buildTextLayer(
  items: unknown[],
  pageHeight: number
): { textHtml: string; charCount: number } {
  if (!items.length) return { textHtml: '', charCount: 0 };
  const out: string[] = [];
  let chars = 0;
  for (const raw of items) {
    const it = raw as { str?: string; transform?: number[]; hasEOL?: boolean };
    const str = typeof it.str === 'string' ? it.str : '';
    if (!str) continue;
    const t = it.transform;
    if (!t || t.length < 6) continue;
    const a = +t[0];
    const b = +t[1];
    const e = +t[4];
    const f = +t[5];
    const fontSize = Math.hypot(a, b);
    if (!isFinite(fontSize) || fontSize <= 0) continue;
    // PDF origin is bottom-left, CSS top-left. The y coord we want is the
    // span's TOP edge — subtract fontSize so positioning matches the
    // glyph's visual top.
    const x = e;
    const y = pageHeight - f - fontSize;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    const rotate = Math.abs(angle) > 1 ? ` rotate(${angle.toFixed(2)}deg)` : '';
    out.push(
      `<span style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;font-size:${fontSize.toFixed(2)}px;transform:scaleX(1)${rotate}">${escapeHtml(str)}</span>`
    );
    chars += [...str].length;
  }
  return { textHtml: out.join(''), charCount: chars };
}

// PDF.js's `PDFPageProxy` has a sprawling render signature that varies
// across minor versions. The two methods we touch (`getViewport`,
// `render`) are stable in shape, so we type them loosely with `any` and
// stay out of the way of the upstream type churn.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pageToJpeg(
  page: any,
  targetWidth: number
): Promise<{ blob: Blob; canvas: HTMLCanvasElement; viewport: { width: number; height: number } }> {
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scaled.width);
  canvas.height = Math.ceil(scaled.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob 失败'))),
      'image/jpeg',
      0.85
    );
  });
  return { blob, canvas, viewport };
}

function thumbnailFromCanvas(canvas: HTMLCanvasElement, targetWidth = 240): string {
  const ratio = targetWidth / canvas.width;
  const h = Math.max(1, Math.round(canvas.height * ratio));
  const thumb = document.createElement('canvas');
  thumb.width = targetWidth;
  thumb.height = h;
  const tctx = thumb.getContext('2d');
  if (!tctx) return '';
  tctx.drawImage(canvas, 0, 0, targetWidth, h);
  return thumb.toDataURL('image/jpeg', 0.7);
}

/** Loader signature mirrors the others in `lib/` so `loadFile` can
 * dispatch by extension without each loader needing custom adapters. */
export async function loadPdf(file: File, onProgress?: (loaded: number, total: number) => void): Promise<ParsedPdf> {
  // Dynamic import keeps the worker + cmaps out of the cold-start bundle.
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  // The worker URL is computed by Vite at build time — point pdfjs at it.
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const pages: PdfPage[] = [];
  let totalChars = 0;
  let coverDataUrl: string | undefined;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const intrinsic = page.getViewport({ scale: 1 });
    const pageW = Math.round(intrinsic.width);
    const pageH = Math.round(intrinsic.height);

    let imageBlob: Blob;
    let renderedCanvas: HTMLCanvasElement | undefined;
    try {
      const rendered = await pageToJpeg(page, IMAGE_RENDER_WIDTH);
      imageBlob = rendered.blob;
      renderedCanvas = rendered.canvas;
    } catch {
      // Render failed on this page — emit a 1×1 placeholder so the array
      // index still maps cleanly to page number, and skip the text layer
      // (without an image to size the shell, the layer would have no
      // coordinate space).
      imageBlob = new Blob(
        [
          Uint8Array.from(atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
          ), (c) => c.charCodeAt(0))
        ],
        { type: 'image/png' }
      );
    }

    if (i === 1 && renderedCanvas) {
      coverDataUrl = thumbnailFromCanvas(renderedCanvas);
    }

    // Text content for the selection layer. Skipped if rendering failed
    // above (no point overlaying text on a placeholder).
    let textHtml = '';
    let charCount = 0;
    if (renderedCanvas) {
      try {
        const tc = await page.getTextContent();
        const built = buildTextLayer(tc.items as unknown[], pageH);
        textHtml = built.textHtml;
        charCount = built.charCount;
      } catch {
        // text extraction can fail on encrypted / unusual PDFs — fine,
        // just no selection on this page.
      }
    }

    pages.push({ imageBlob, width: pageW, height: pageH, textHtml, charCount });
    totalChars += charCount;
    onProgress?.(i, doc.numPages);

    page.cleanup();
  }
  await doc.cleanup();
  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();

  const title = file.name.replace(/\.pdf$/i, '');
  return { kind: 'pdf', title, pages, coverDataUrl, totalChars };
}
