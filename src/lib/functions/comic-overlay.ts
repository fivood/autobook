/**
 * Render translated-text overlay on a comic's page images.
 *
 * The translation job stores, per bubble, the OCR polygon (image pixel
 * coordinates) and the translated text (keyed by the same segment id). This
 * module positions a `<span>` per translated bubble over the corresponding
 * `img[data-pdf-page]`, scaling image pixels to the image's rendered size —
 * so the overlay stays glued to the artwork at any zoom or window width.
 *
 * The overlay is purely additive: it never touches the page image or the
 * underlying HTML, so removing it (or the job) leaves the book intact.
 */

import { findComicTranslationJob } from '$lib/data/translation/translation-job-store';
import { orderPageBubbles } from '$lib/functions/comic-inpaint-regions';

const OVERLAY_CLASS = 'comic-translation-overlay';
const OVERLAY_LAYER = 'comic-translation-layer';

function bubbleRect(poly: [number, number][]): { x: number; y: number; w: number; h: number } | null {
  if (!poly || poly.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    const x = p[0];
    const y = p[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

/**
 * Wrap the translated text in a span laid out in image pixel space, with
 * adaptive sizing so it fits the bubble rather than spilling out.
 *
 * Font size is derived from the bubble's *source line height* (bbox height ÷
 * source line count), then clamped by width (so a long translation wraps) and
 * by estimated translated-line count (shrink until it fits, floor 10px). This
 * is the cover-layer analogue of M4's baked auto-layout — DOM text wraps
 * naturally, so no canvas math needed.
 */
function buildSpan(
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  sourceLineCount: number
): HTMLElement {
  const span = document.createElement('span');
  span.className = OVERLAY_CLASS;
  span.textContent = text;
  span.style.position = 'absolute';
  span.style.left = `${rect.x}px`;
  span.style.top = `${rect.y}px`;

  // Base size from one source line height, with horizontal padding.
  const sourceLineH = Math.max(10, rect.h / Math.max(1, sourceLineCount));
  const maxFontW = Math.max(8, rect.w / 12); // ~12 chars/line lower bound for CJK
  let fontSize = Math.min(sourceLineH * 0.85, rect.w / 3, maxFontW * 1.5);

  // Shrink until the estimated wrapped lines fit the bubble height.
  const targetChars = [...text].length;
  for (let guard = 0; guard < 20; guard += 1) {
    const perLine = Math.max(1, Math.floor(rect.w / Math.max(1, fontSize)));
    const lines = Math.max(1, Math.ceil(targetChars / perLine));
    const needed = lines * fontSize * 1.2;
    if (needed <= rect.h * 0.95 || fontSize <= 10) break;
    fontSize *= 0.9;
  }
  fontSize = Math.max(10, Math.round(fontSize));

  span.style.fontSize = `${fontSize}px`;
  span.style.width = `${rect.w}px`;
  span.style.minWidth = `${rect.w}px`;
  span.style.lineHeight = '1.2';
  span.style.whiteSpace = 'pre-wrap';
  span.style.wordBreak = 'break-word';
  span.style.overflowWrap = 'anywhere';
  span.style.color = '#000';
  // White halo keeps text readable over busy panels (M2/M3 erased bubbles,
  // but un-erased SFX/lettering may still sit behind).
  span.style.textShadow = '0 0 3px #fff, 0 0 6px #fff, 0 0 2px #fff';
  span.style.fontWeight = '600';
  span.style.opacity = '0.95';
  span.style.pointerEvents = 'none';
  span.style.userSelect = 'none';
  return span;
}

/** One overlay layer per page image, containing all translated bubbles.
 * The layer is anchored to the img's box (offset within its section), so
 * the h3 page label above the img stays visible and the coordinate space
 * lines up exactly with the artwork. */
function ensureLayer(pageSection: HTMLElement): { layer: HTMLElement; img: HTMLImageElement } | null {
  let layer = pageSection.querySelector<HTMLElement>(`.${OVERLAY_LAYER}`);
  const img = pageSection.querySelector<HTMLImageElement>('img[data-pdf-page]');
  if (!img) return null;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = OVERLAY_LAYER;
    layer.style.position = 'absolute';
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'hidden';
    layer.style.transformOrigin = '0 0';
    pageSection.style.setProperty('position', 'relative');
    pageSection.appendChild(layer);
  }
  return { layer, img };
}

/** Anchor the layer over the img's rendered box and scale spans to match. */
function scaleLayer(layer: HTMLElement, img: HTMLImageElement, baseW: number, baseH: number) {
  const imgW = img.clientWidth || 1;
  const imgH = img.clientHeight || 1;
  const scaleX = imgW / (baseW || 1);
  const scaleY = imgH / (baseH || 1);
  const offsetLeft = img.offsetLeft;
  const offsetTop = img.offsetTop;
  layer.style.left = `${offsetLeft}px`;
  layer.style.top = `${offsetTop}px`;
  layer.style.width = `${imgW}px`;
  layer.style.height = `${imgH}px`;
  // Spans are laid out in image pixel space; scale the whole layer to the
  // rendered size. Non-uniform scale is fine for bubbles (they're usually
  // near axis-aligned).
  layer.style.transform = `scale(${scaleX}, ${scaleY})`;
}

export interface ComicOverlayOptions {
  /** Book title used to find the matching translation job. */
  title: string;
  /** The reader content root containing the page images. */
  contentEl: () => HTMLElement | null;
  /** Called once the overlay is applied or found nothing to apply. */
  onApplied?: (count: number) => void;
  /** Called as soon as a translation job with output is found — before any
   * spans necessarily render (images may still be lazy-loading). The caller
   * uses this to hide "open the translation workbench" prompts. */
  onHasTranslation?: () => void;
  /** Called once per translated bubble span, after it's positioned. The
   * caller can attach order badges / click handlers for manual re-ordering. */
  onSpanCreated?: (span: HTMLElement, bubble: { id: string; pageIndex: number }, order: number) => void;
  /** Optional storage used to swap in in-painted (source-text-erased) page
   * images beneath the translated overlay. Absent in pure-browser builds. */
  inpaintStorage?: {
    readInpainted(cacheKey: string, pageIndex: number): Promise<Blob | null>;
  };
}

/** Lazily-created object URLs for inpainted page images, revoked on clear. */
const inpaintUrls = new Map<string, string>();

async function swapInpaintedBackdrop(
  cacheKey: string,
  pageIndex: number,
  img: HTMLImageElement,
  inpaintStorage: NonNullable<ComicOverlayOptions['inpaintStorage']>
) {
  const urlKey = `${cacheKey}|${pageIndex}`;
  let url = inpaintUrls.get(urlKey);
  if (!url) {
    const blob = await inpaintStorage.readInpainted(cacheKey, pageIndex);
    if (!blob) return;
    url = URL.createObjectURL(blob);
    inpaintUrls.set(urlKey, url);
  }
  // Only swap when the current source is the original page image (not an
  // already-swapped one or a cover placeholder).
  if (img.src !== url) img.src = url;
}

export async function applyComicOverlay(options: ComicOverlayOptions): Promise<number> {
  const job = await findComicTranslationJob(options.title);
  if (!job) return 0;
  const translations = Object.keys(job.translations).length ? job.translations : null;
  if (!translations) return 0;
  options.onHasTranslation?.();

  const cacheKey = job.document.metadata?.cacheKey as string | undefined;
  // Page offset from the translation job: OCR slices off the cover by default,
  // so bubble pageIndex (0-based within the slice) must be shifted by this to
  // land on the raw 1-based data-pdf-page of the full book.
  const startPage = Number(job.document.metadata?.startPage) || 0;
  const state = job.document.state as { bubbles?: Array<{ id: string; pageIndex: number; poly: [number, number][]; text?: string }>; pages?: Array<{ imageWidth: number; imageHeight: number }> } | undefined;
  const bubbles = state?.bubbles || [];
  const pages = state?.pages || [];
  if (!bubbles.length) return 0;

  const root = options.contentEl();
  if (!root) return 0;

  const byPage = new Map<number, typeof bubbles>();
  for (const bubble of bubbles) {
    if (!translations[bubble.id]) continue;
    const list = byPage.get(bubble.pageIndex) || [];
    list.push(bubble);
    byPage.set(bubble.pageIndex, list);
  }

  // Map pageIndex (0-based within OCR slice) to raw img data-pdf-page (1-based
  // on the full book, cover offset applied).
  let rendered = 0;
  for (const [pageIndex, pageBubbles] of byPage) {
    const pageNum = pageIndex + startPage + 1;
    const img = root.querySelector<HTMLImageElement>(`img[data-pdf-page="${pageNum}"]`);
    if (!img) continue;
    const section = img.closest('.cbz-section') as HTMLElement | null;
    if (!section) continue;
    const pageInfo = pages[pageIndex];
    const baseW = pageInfo?.imageWidth || img.naturalWidth || 1;
    const baseH = pageInfo?.imageHeight || img.naturalHeight || 1;

    // Use the in-painted page as the backdrop when available, so translated
    // text sits on a clean bubble instead of over the original lettering.
    if (cacheKey && options.inpaintStorage) {
      swapInpaintedBackdrop(cacheKey, pageIndex, img, options.inpaintStorage).catch(() => {
        // Backdrop swap is best-effort; fall back to the original page.
      });
    }

    const anchored = ensureLayer(section);
    if (!anchored) continue;
    const { layer } = anchored;

    // Idempotent re-apply: replace this page's spans rather than stacking
    // duplicates on every resize/scroll tick.
    layer.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((span) => span.remove());

    // Reading order: use the manually adjusted order when present (Western
    // comics left→right), else the OCR Y-sorted default. Order drives both
    // DOM order and (optionally) reveal-on-progress.
    const ordered = cacheKey ? orderPageBubbles(cacheKey, pageIndex, pageBubbles) : pageBubbles;
    for (let orderIdx = 0; orderIdx < ordered.length; orderIdx += 1) {
      const bubble = ordered[orderIdx];
      const rect = bubbleRect(bubble.poly);
      if (!rect) continue;
      // Source line count drives the base font size — a 3-line bubble gets a
      // smaller per-line font than a 1-liner, so the translation fits.
      const sourceLines = Math.max(1, (bubble.text?.split('\n').length) || 1);
      const span = buildSpan(translations[bubble.id], rect, sourceLines);
      layer.appendChild(span);
      options.onSpanCreated?.(span, { id: bubble.id, pageIndex }, orderIdx);
      rendered += 1;
    }
    scaleLayer(layer, img, baseW, baseH);
  }

  options.onApplied?.(rendered);
  return rendered;
}

/**
 * Re-apply the overlay after the content re-renders (image lazy-load, view
 * mode switch). Cheap when there's no job: the IDB lookup short-circuits.
 */
export function clearComicOverlay(root?: HTMLElement | null) {
  const scope = root || document;
  scope.querySelectorAll(`.${OVERLAY_LAYER}`).forEach((layer) => layer.remove());
  for (const url of inpaintUrls.values()) URL.revokeObjectURL(url);
  inpaintUrls.clear();
}
