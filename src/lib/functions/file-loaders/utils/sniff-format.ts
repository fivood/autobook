/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Magic-byte based format detection. Used as a fallback when the file
 * extension is missing or wrong (iOS share sheets, drag from chat apps,
 * renamed-by-user, etc.). Only covers signatures that are 100%
 * unambiguous; ambiguous ZIPs (epub/htmlz/cbz/zip-bundle) still need an
 * extension or content inspection elsewhere.
 */

export type SniffedFormat = 'pdf' | 'mobi' | 'zip' | null;

export async function sniffFormat(file: File): Promise<SniffedFormat> {
  try {
    const head = new Uint8Array(await file.slice(0, 68).arrayBuffer());
    // %PDF at offset 0 → PDF
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      return 'pdf';
    }
    // PK\x03\x04 → ZIP family (epub / htmlz / cbz / zip-of-books)
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
      return 'zip';
    }
    // BOOKMOBI at offset 60 → MOBI / KF8
    if (head.length >= 68) {
      const sig = String.fromCharCode(...head.subarray(60, 68));
      if (sig === 'BOOKMOBI') return 'mobi';
    }
  } catch {
    // ignore — fall back to extension dispatch
  }
  return null;
}

/**
 * For ZIP files (which span epub/htmlz/cbz), peek at the first member
 * to disambiguate. EPUBs have `mimetype` as the first file; HTMLZ has
 * `index.html`; CBZ has an image; bundle ZIPs have nested books.
 */
export async function sniffZipKind(
  file: File
): Promise<'epub' | 'htmlz' | 'cbz' | null> {
  try {
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(file));
    try {
      const entries = await reader.getEntries();
      const names = entries.filter((e) => !e.directory).map((e) => e.filename);
      if (names.some((n) => /^mimetype$/i.test(n))) return 'epub';
      if (names.some((n) => /^index\.html$/i.test(n))) return 'htmlz';
      if (names.every((n) => /\.(jpe?g|png|webp|gif|bmp|xml)$/i.test(n))) {
        // pure image archive (with optional ComicInfo.xml) → CBZ
        return 'cbz';
      }
    } finally {
      await reader.close();
    }
  } catch {
    // ignore
  }
  return null;
}
