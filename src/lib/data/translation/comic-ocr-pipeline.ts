import type { OcrLine, OcrPageResult, OcrEngine, OcrEngineLanguage, ComicBubble, ComicPageInfo, ComicStorage } from 'translator-workbench';
import { ocrImageBlob, type OcrLanguage } from '$lib/functions/file-loaders/pdf/pdf-ocr';

/**
 * Adapts AutoBook's PaddleOCR wrapper to the workbench OcrEngine interface.
 */
export class PaddleOcrEngine implements OcrEngine {
  async predict(image: Blob, lang: OcrEngineLanguage): Promise<OcrPageResult> {
    const result = await ocrImageBlob(image, lang as OcrLanguage);
    return {
      items: result.items.map((it) => ({
        text: it.text,
        poly: it.poly,
        score: it.score
      })),
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight
    };
  }
}

interface OcrCacheData {
  items: OcrLine[];
  imageWidth: number;
  imageHeight: number;
  bubbles: ComicBubble[];
}

/**
 * Compute the centroid of a polygon.
 */
function centroid(poly: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  return [cx / poly.length, cy / poly.length];
}

/**
 * Bounding box of a polygon: [minX, minY, maxX, maxY].
 */
function bbox(poly: [number, number][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Vertical gap between two bounding boxes. Negative means overlap.
 */
function verticalGap(a: [number, number, number, number], b: [number, number, number, number]): number {
  return Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
}

/**
 * Check if two bounding boxes overlap horizontally.
 */
function horizontalOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[2] && b[0] < a[2];
}

/**
 * Group OCR lines into bubbles. Lines that are vertically close and
 * horizontally overlapping are merged into a single bubble.
 */
export function groupLinesToBubbles(
  items: OcrLine[],
  pageIndex: number,
  imageHeight: number
): ComicBubble[] {
  if (!items.length) return [];

  const lineHeight = imageHeight * 0.04;
  const maxGap = lineHeight * 1.5;

  const boxes = items.map((it) => bbox(it.poly));
  const merged = new Array<boolean>(items.length).fill(false);
  const groups: number[][] = [];

  for (let i = 0; i < items.length; i++) {
    if (merged[i]) continue;
    const group = [i];
    merged[i] = true;

    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < items.length; j++) {
        if (merged[j]) continue;
        for (const gi of group) {
          const gap = verticalGap(boxes[gi], boxes[j]);
          if (gap < maxGap && horizontalOverlap(boxes[gi], boxes[j])) {
            group.push(j);
            merged[j] = true;
            changed = true;
            break;
          }
        }
      }
    }
    groups.push(group);
  }

  const bubbles: ComicBubble[] = groups.map((group, idx) => {
    group.sort((a, b) => {
      const [, ay] = centroid(items[a].poly);
      const [, by] = centroid(items[b].poly);
      return ay - by;
    });

    const text = group.map((i) => items[i].text).join('\n');
    const allPoints = group.flatMap((i) => items[i].poly);
    const [minX, minY, maxX, maxY] = bbox(allPoints);
    const poly: [number, number][] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY]
    ];

    return {
      id: `p${pageIndex}_b${idx}`,
      pageIndex,
      text,
      poly,
      orderInPage: idx
    };
  });

  bubbles.sort((a, b) => {
    const [, ay] = centroid(a.poly);
    const [, by] = centroid(b.poly);
    return ay - by;
  });

  bubbles.forEach((b, i) => {
    b.orderInPage = i;
    b.id = `p${pageIndex}_b${i}`;
  });

  return bubbles;
}

export interface ComicOcrProgress {
  page: number;
  total: number;
  cached: boolean;
}

/**
 * Run OCR on all pages of a comic, using the cache to skip already-processed
 * pages. Returns per-page info and all bubbles.
 */
export async function ocrComic(
  pageBlobs: Blob[],
  lang: OcrEngineLanguage,
  jobId: string,
  storage: ComicStorage,
  onProgress?: (progress: ComicOcrProgress) => void
): Promise<{ pages: ComicPageInfo[]; bubbles: ComicBubble[] }> {
  const engine = new PaddleOcrEngine();
  const pages: ComicPageInfo[] = [];
  const allBubbles: ComicBubble[] = [];

  for (let i = 0; i < pageBlobs.length; i++) {
    onProgress?.({ page: i, total: pageBlobs.length, cached: false });

    const cached = (await storage.readOcrCache(jobId, i)) as OcrCacheData | null;
    if (cached) {
      onProgress?.({ page: i, total: pageBlobs.length, cached: true });
      pages.push({
        index: i,
        imageWidth: cached.imageWidth,
        imageHeight: cached.imageHeight,
        imagePath: `pages/${String(i).padStart(4, '0')}.bin`
      });
      allBubbles.push(...cached.bubbles);
      continue;
    }

    await storage.writePage(jobId, i, pageBlobs[i]);

    const result = await engine.predict(pageBlobs[i], lang);
    const bubbles = groupLinesToBubbles(result.items, i, result.imageHeight);

    const cacheData: OcrCacheData = {
      items: result.items,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      bubbles
    };
    await storage.writeOcrCache(jobId, i, cacheData);

    pages.push({
      index: i,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      imagePath: `pages/${String(i).padStart(4, '0')}.bin`
    });
    allBubbles.push(...bubbles);
  }

  return { pages, bubbles: allBubbles };
}
