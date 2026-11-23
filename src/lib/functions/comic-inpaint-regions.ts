/**
 * Persist user-drawn inpainting regions (M2 manual correction). Regions drawn
 * on the page image during edit mode are stored per comic cache key, so the
 * overlay can merge them into the bubble list on every apply and erase the
 * spots OCR missed (SFX, art-lettering, etc.).
 *
 * Stored in localStorage — tiny data (a few polys per page), survives the
 * session, and avoids another IndexedDB schema. Browser-safe.
 */

import type { InpaintBubble } from '$lib/functions/comic-inpaint';

const KEY_PREFIX = 'comicManualRegions:';

export type ManualRegion = { id: string; poly: [number, number][] };

function readAll(cacheKey: string): Record<number, ManualRegion[]> {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cacheKey);
    return raw ? (JSON.parse(raw) as Record<number, ManualRegion[]>) : {};
  } catch {
    return {};
  }
}

function writeAll(cacheKey: string, byPage: Record<number, ManualRegion[]>) {
  try {
    localStorage.setItem(KEY_PREFIX + cacheKey, JSON.stringify(byPage));
  } catch {
    // Persist failure only loses manual regions for this session.
  }
}

export function getManualRegions(cacheKey: string, pageIndex: number): ManualRegion[] {
  return readAll(cacheKey)[pageIndex] || [];
}

export function getAllManualRegions(cacheKey: string): Record<number, ManualRegion[]> {
  return readAll(cacheKey);
}

export function addManualRegion(cacheKey: string, pageIndex: number, region: ManualRegion) {
  const all = readAll(cacheKey);
  const list = all[pageIndex] || [];
  list.push(region);
  all[pageIndex] = list;
  writeAll(cacheKey, all);
}

export function removeManualRegion(cacheKey: string, pageIndex: number, id: string) {
  const all = readAll(cacheKey);
  const list = all[pageIndex] || [];
  const next = list.filter((r) => r.id !== id);
  if (next.length) all[pageIndex] = next;
  else delete all[pageIndex];
  writeAll(cacheKey, all);
}

export function clearManualRegions(cacheKey: string, pageIndex?: number) {
  const all = readAll(cacheKey);
  if (pageIndex === undefined) {
    writeAll(cacheKey, {});
    return;
  }
  delete all[pageIndex];
  writeAll(cacheKey, all);
}

/** All bubbles for a page: OCR bubbles + user-drawn regions, deduped. */
export function pageInpaintBubbles(
  cacheKey: string,
  pageIndex: number,
  ocrBubbles: InpaintBubble[]
): InpaintBubble[] {
  const manual = getManualRegions(cacheKey, pageIndex);
  return [...ocrBubbles, ...manual];
}

// ── Reading order (M2) ────────────────────────────────────────────────
// Per-page bubble reading order, persisted so the reader can show overlays
// in the correct order (Western left→right, manga right→left). OCR grouping
// sorts by Y only, which loses horizontal order for same-row bubbles.

const ORDER_PREFIX = 'comicBubbleOrder:';

function readOrder(cacheKey: string): Record<number, string[]> {
  try {
    const raw = localStorage.getItem(ORDER_PREFIX + cacheKey);
    return raw ? (JSON.parse(raw) as Record<number, string[]>) : {};
  } catch {
    return {};
  }
}

function writeOrder(cacheKey: string, byPage: Record<number, string[]>) {
  try {
    localStorage.setItem(ORDER_PREFIX + cacheKey, JSON.stringify(byPage));
  } catch {
    // Persist failure only loses manual order for this session.
  }
}

export function getBubbleOrder(cacheKey: string, pageIndex: number): string[] | undefined {
  return readOrder(cacheKey)[pageIndex];
}

export function setBubbleOrder(cacheKey: string, pageIndex: number, orderedIds: string[]) {
  const all = readOrder(cacheKey);
  all[pageIndex] = orderedIds;
  writeOrder(cacheKey, all);
}

export function clearBubbleOrder(cacheKey: string, pageIndex?: number) {
  const all = readOrder(cacheKey);
  if (pageIndex === undefined) writeOrder(cacheKey, {});
  else {
    delete all[pageIndex];
    writeOrder(cacheKey, all);
  }
}

/**
 * Order the bubbles of a page: persisted manual order first, falling back to
 * the default (Y-sorted) order. Returns the list sorted for display.
 */
export function orderPageBubbles<T extends { id: string }>(
  cacheKey: string,
  pageIndex: number,
  bubbles: T[]
): T[] {
  const manual = getBubbleOrder(cacheKey, pageIndex);
  if (!manual || !manual.length) return bubbles;
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const ordered: T[] = [];
  for (const id of manual) {
    const b = byId.get(id);
    if (b) {
      ordered.push(b);
      byId.delete(id);
    }
  }
  // Any bubble not in the manual list keeps its original relative order.
  for (const b of bubbles) if (byId.has(b.id)) ordered.push(b);
  return ordered;
}
