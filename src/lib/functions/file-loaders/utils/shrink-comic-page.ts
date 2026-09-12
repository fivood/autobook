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

/** WebP at this quality is visually clean on line art and screentone alike and
 *  lands roughly an order of magnitude below an 8 MB scan. */
const QUALITY = 0.85;

export interface ShrunkPage {
  blob: Blob;
  /** File extension to store it under — callers key blobs by name, and the
   *  reader derives the mime type back out of that name. */
  ext: string;
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
  if (blob.size <= PASSTHROUGH_BYTES) return { blob, ext: originalExt };
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { blob, ext: originalExt };
  }

  let bitmap: ImageBitmap | undefined;

  try {
    bitmap = await createImageBitmap(blob);

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return { blob, ext: originalExt };

    context.drawImage(bitmap, 0, 0, width, height);

    const shrunk = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });

    // A page that got bigger (already-optimised art at low resolution) keeps
    // its original bytes rather than paying for a lossy round trip.
    return shrunk.size < blob.size ? { blob: shrunk, ext: 'webp' } : { blob, ext: originalExt };
  } catch {
    // Decoder said no — CMYK JPEG, a format this build has no decoder for, a
    // truncated entry. Keep what the archive gave us.
    return { blob, ext: originalExt };
  } finally {
    bitmap?.close();
  }
}
