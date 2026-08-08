/**
 * Bubble inpainting (M2): erase source-text from speech bubbles by filling
 * them with their background colour.
 *
 * Strategy — cheap and high-coverage, leaving hard cases for LaMa:
 *   1. For each bubble, sample an annular strip just inside the bubble's
 *      bounding box (the bubble rim, away from the centred text) to estimate
 *      the background colour.
 *   2. If that sample is uniform enough (per-channel variance below a
 *      threshold), fill the whole bubble with the sampled median colour.
 *      Colour-graded or heavily-textured backgrounds exceed the threshold and
 *      are left untouched for the LaMa stage.
 *   3. The fill region is the bubble poly expanded ~8% so the lettering's
 *      outline / anti-aliasing edge is covered too.
 *
 * Runs in the browser via <canvas>; the page image is read from the comic
 * cache and the result written back to the inpaint cache.
 */

export interface InpaintBubble {
  id: string;
  poly: [number, number][];
}

import { inpaintWithLama } from '$lib/functions/comic-lama';

export interface InpaintResult {
  /** Number of bubbles actually filled (below the variance threshold). */
  inpainted: number;
  /** Bubbles skipped because their background was too complex for flat fill. */
  skipped: string[];
}

const VARIANCE_THRESHOLD = 150;
/** Expand each bubble bbox by this fraction to cover the lettering outline. */
const EXPAND_RATIO = 0.08;

/**
 * Robust spread: standard deviation after trimming pixels far from the
 * median. Comic bubbles carry a dark outline; those few outline pixels would
 * otherwise inflate the variance of an otherwise-flat fill and get it skipped
 * as "complex background".
 */
function trimmedSpread(values: number[], medianVal: number): number {
  if (values.length < 4) return Infinity;
  const trimmed = values.filter((v) => Math.abs(v - medianVal) <= 60);
  if (trimmed.length < values.length * 0.4) return Infinity;
  return stddev(trimmed, median(trimmed));
}

function bboxOf(poly: [number, number][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Load a blob into an offscreen canvas; returns the canvas + 2D context. */
async function loadImage(blob: Blob): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, ctx };
}

/**
 * Sample the bubble background. The bubble's actual fill extends beyond the
 * OCR text bounding box, so we sample the *expanded* box's corners — the
 * lettering sits inset from the bubble edge, leaving a clean background band
 * outside the text bbox where the corner samples land.
 */
function sampleRim(ctx: CanvasRenderingContext2D, box: [number, number, number, number], imageW: number, imageH: number) {
  const [minX, minY, maxX, maxY] = box;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < 8 || h < 8) return null;
  const ex = Math.max(2, w * EXPAND_RATIO);
  const ey = Math.max(2, h * EXPAND_RATIO);
  const cx0 = minX - ex, cy0 = minY - ey;
  const cx1 = maxX + ex, cy1 = maxY + ey;
  // Corner square size ~15% of the (expanded) box.
  const corner = Math.max(4, Math.round(Math.min(w + 2 * ex, h + 2 * ey) * 0.15));
  const corners: Array<[number, number]> = [
    [cx0, cy0],
    [cx1 - corner, cy0],
    [cx0, cy1 - corner],
    [cx1 - corner, cy1 - corner]
  ];
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const [sx, sy] of corners) {
    const x0 = Math.max(0, Math.floor(sx));
    const y0 = Math.max(0, Math.floor(sy));
    const x1 = Math.min(imageW, Math.ceil(sx + corner));
    const y1 = Math.min(imageH, Math.ceil(sy + corner));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const pixels = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const width = x1 - x0;
    for (let py = 0; py < y1 - y0; py += 2) {
      for (let px = 0; px < x1 - x0; px += 2) {
        const idx = (py * width + px) * 4;
        r.push(pixels[idx]);
        g.push(pixels[idx + 1]);
        b.push(pixels[idx + 2]);
      }
    }
  }
  if (r.length < 8) return null;

  const mr = median(r), mg = median(g), mb = median(b);
  const variance = (trimmedSpread(r, mr) + trimmedSpread(g, mg) + trimmedSpread(b, mb)) / 3;
  return { color: [mr, mg, mb] as [number, number, number], variance };
}

/**
 * Fill one bubble's bbox (expanded) with a flat colour. Uses the expanded
 * bbox rather than the raw polygon — bubbles are near-axis-aligned in
 * practice, and a rectangle is simpler and safer than tracing the poly.
 */
function fillBubble(ctx: CanvasRenderingContext2D, box: [number, number, number, number], color: [number, number, number], imageW: number, imageH: number) {
  const [minX, minY, maxX, maxY] = box;
  const w = maxX - minX;
  const h = maxY - minY;
  const ex = Math.max(1, w * EXPAND_RATIO);
  const ey = Math.max(1, h * EXPAND_RATIO);
  const x0 = Math.max(0, Math.floor(minX - ex));
  const y0 = Math.max(0, Math.floor(minY - ey));
  const x1 = Math.min(imageW, Math.ceil(maxX + ex));
  const y1 = Math.min(imageH, Math.ceil(maxY + ey));
  ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

export async function inpaintPage(
  pageBlob: Blob,
  bubbles: InpaintBubble[],
  onProgress?: (done: number, total: number) => void
): Promise<{ result: InpaintResult; blob: Blob }> {
  if (!bubbles.length) return { result: { inpainted: 0, skipped: [] }, blob: pageBlob };

  const { canvas, ctx } = await loadImage(pageBlob);
  const imageW = canvas.width;
  const imageH = canvas.height;
  const inpainted: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i];
    const box = bboxOf(bubble.poly);
    const sample = sampleRim(ctx, box, imageW, imageH);
    if (sample && sample.variance <= VARIANCE_THRESHOLD) {
      fillBubble(ctx, box, sample.color, imageW, imageH);
      inpainted.push(bubble.id);
    } else {
      skipped.push(bubble.id);
    }
    onProgress?.(i + 1, bubbles.length);
  }

  const blob: Blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.92);
  });
  return { result: { inpainted: inpainted.length, skipped }, blob };
}

/**
 * Flat-fill first, then hand the bubbles it skipped (gradient / textured
 * backgrounds) to a LaMa sidecar for proper reconstruction. Falls back to the
 * flat-fill result when the sidecar is unreachable or errors — never worse
 * than M2 alone.
 */
export async function inpaintPageWithLama(
  pageBlob: Blob,
  bubbles: InpaintBubble[],
  lamaEndpoint: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ result: InpaintResult; blob: Blob }> {
  const filled = await inpaintPage(pageBlob, bubbles, onProgress);
  const skippedBubbles = bubbles.filter((b) => filled.result.skipped.includes(b.id));
  if (!lamaEndpoint || !skippedBubbles.length) return filled;

  const lama = await inpaintWithLama(filled.blob, skippedBubbles, lamaEndpoint);
  if (!lama.ok || !lama.blob) return filled;

  const skipped = skippedBubbles.map((b) => b.id);
  const remaining = filled.result.skipped.filter((id) => !skipped.includes(id));
  return {
    result: {
      inpainted: filled.result.inpainted + skipped.length,
      skipped: remaining
    },
    blob: lama.blob
  };
}
