/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Re-encode oversized comic pages down to something a screen can actually use.
 *
 * Why this exists: a 991 MB / 185-page CBR (8 MB per page, 4000+ px scans) took
 * the WebView renderer down three separate ways — deflating the pages during
 * save, materialising the 997 MB zip as one contiguous Uint8Array to write it,
 * and reading it back the same way. Each of those is fixed on its own, and the
 * book still killed the renderer on open: the whole pipeline is Blob-in-memory
 * where Calibre's comic input is file-on-disk, and no amount of streaming one
 * layer at a time changes that.
 *
 * Calibre's answer to the same problem is not to carry the pixels around at
 * all: its comic input renders every page to the output profile's screen size
 * before anything downstream sees it. This is that, narrowed to the case that
 * hurts — pages already small enough are passed through untouched, so ordinary
 * comics import byte-for-byte as before.
 */

/** Below this a page is left exactly as it came out of the archive. Chosen so
 *  normal digital comics (typically 200 KB – 1 MB per page) never re-encode. */
const PASSTHROUGH_BYTES = 1_500_000;

/** Longest edge to keep. Comfortably above any current display's short edge,
 *  so zooming a page still has pixels to show. */
const MAX_EDGE = 2400;

/**
 * JPEG, not WebP, and this is the whole difference between a tolerable import
 * and an unusable one. Measured on this book at 1561x2400, per page:
 *
 *   webp q0.85   456 ms   635 KB
 *   webp q0.80   410 ms   524 KB
 *   jpeg q0.85    39 ms   842 KB
 *
 * WebP costs 12x the encode time to save a third of the bytes — 84 seconds
 * versus 7 across 185 pages, on a step that is already the slowest part of
 * importing a comic. The extra bytes are worth it; the minutes are not.
 */
const QUALITY = 0.85;
const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_EXT = 'jpg';

export interface ShrunkPage {
  blob: Blob;
  /** File extension to store it under — callers key blobs by name, and the
   *  reader derives the mime type back out of that name. */
  ext: string;
}

export function canShrink() {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
}

/**
 * Decode, scale to screen size, re-encode. Returns null when the page should
 * keep the bytes it already has — too small to bother with, undecodable, or a
 * re-encode that came out bigger than the original.
 *
 * The worker (shrink-comic-page.worker.ts) imports this same function, so both
 * paths produce identical files.
 */
export async function encodeToScreenSize(blob: Blob): Promise<Blob | null> {
  if (blob.size <= PASSTHROUGH_BYTES || !canShrink()) return null;

  let bitmap: ImageBitmap | undefined;

  try {
    bitmap = await createImageBitmap(blob);

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    // JPEG has no alpha, and a transparent PNG page would otherwise come out
    // with a black background.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    const shrunk = await canvas.convertToBlob({ type: OUTPUT_TYPE, quality: QUALITY });

    // A page that got bigger (already-optimised art at low resolution) keeps
    // its original bytes rather than paying for a lossy round trip.
    return shrunk.size < blob.size ? shrunk : null;
  } catch {
    // Decoder said no — CMYK JPEG, a format this build has no decoder for, a
    // truncated entry. Keep what the archive gave us.
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * Returns the page unchanged unless it is both large and shrinkable.
 *
 * Never throws: a page the decoder cannot read is passed through as-is. A
 * too-big page still renders; a missing one does not.
 */
export default async function shrinkComicPage(
  blob: Blob,
  originalExt: string
): Promise<ShrunkPage> {
  const shrunk = await encodeToScreenSize(blob);

  return shrunk ? { blob: shrunk, ext: OUTPUT_EXT } : { blob, ext: originalExt };
}

/**
 * Four workers, not sixteen. Measured per page on a 1988x3056 scan: 152 ms in
 * process, 53 ms across four workers, 39 ms across eight. The last doubling
 * buys 14 ms a page and doubles the number of decoded bitmaps alive at once
 * (~24 MB each at this size) — and on the book that motivated all of this,
 * memory headroom is the thing that was actually scarce.
 */
const POOL_SIZE = 4;

/** How far the caller's extraction loop may run ahead of the pool. Two pages
 *  per worker keeps every worker fed without letting a whole archive's worth of
 *  extracted pages pile up behind them. */
export const PAGES_IN_FLIGHT = POOL_SIZE * 2;

export interface ComicPageShrinker {
  shrink(blob: Blob, originalExt: string): Promise<ShrunkPage>;
  close(): void;
}

interface PendingJob {
  blob: Blob;
  resolve: (shrunk: Blob | null) => void;
}

/**
 * A pool of workers doing what shrinkComicPage does.
 *
 * Throughput is only half the reason (152 ms a page against 53). The other
 * half is that decoding and encoding in process pins the main thread for the
 * whole import, so Svelte never gets a frame and the import progress bar sits
 * frozen — the loader phase was a flat 0% for its entire duration. Off-thread,
 * the bar moves.
 *
 * Callers must close() it. A page whose worker dies is re-done in process, so
 * a broken pool is slow rather than fatal.
 */
export function createComicPageShrinker(): ComicPageShrinker {
  const idle: Worker[] = [];
  const queue: PendingJob[] = [];
  let alive = 0;
  let closed = false;
  let poolBroken = false;

  function spawn(): Worker | undefined {
    try {
      const worker = new Worker(new URL('./shrink-comic-page.worker.ts', import.meta.url), {
        type: 'module'
      });

      alive += 1;

      return worker;
    } catch {
      // No worker support, or the bundle never shipped the chunk. Everything
      // from here runs in process.
      poolBroken = true;

      return undefined;
    }
  }

  function release(worker: Worker, healthy: boolean) {
    worker.onmessage = null;
    worker.onerror = null;

    if (!healthy || closed) {
      worker.terminate();
      alive -= 1;
      return;
    }

    const next = queue.shift();

    if (next) {
      run(worker, next);
    } else {
      idle.push(worker);
    }
  }

  function run(worker: Worker, job: PendingJob) {
    worker.onmessage = (event: MessageEvent<{ blob: Blob | null }>) => {
      release(worker, true);
      job.resolve(event.data.blob);
    };

    worker.onerror = () => {
      release(worker, false);
      // The page still has to come out somewhere.
      encodeToScreenSize(job.blob).then(job.resolve, () => job.resolve(null));
    };

    worker.postMessage({ blob: job.blob });
  }

  function dispatch(job: PendingJob) {
    const worker = idle.pop() ?? (alive < POOL_SIZE ? spawn() : undefined);

    if (worker) {
      run(worker, job);
    } else if (poolBroken) {
      encodeToScreenSize(job.blob).then(job.resolve, () => job.resolve(null));
    } else {
      queue.push(job);
    }
  }

  return {
    async shrink(blob, originalExt) {
      if (closed || !canShrink()) return shrinkComicPage(blob, originalExt);

      const shrunk = await new Promise<Blob | null>((resolve) => {
        dispatch({ blob, resolve });
      });

      return shrunk ? { blob: shrunk, ext: OUTPUT_EXT } : { blob, ext: originalExt };
    },
    close() {
      closed = true;
      queue.length = 0;
      idle.forEach((worker) => worker.terminate());
      idle.length = 0;
      alive = 0;
    }
  };
}
