/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * CBZ (Comic Book ZIP) loader. A CBZ is a plain ZIP archive containing
 * page images (.jpg / .png / .webp / .gif), one per file, named in
 * reading order. Optionally includes ComicInfo.xml metadata.
 *
 * We unzip, sort by filename (natural-sort so page2 < page10), and
 * generate one section per image — exactly the same HTML shape used by
 * the PDF loader's image mode, so the reader / page tracker work as-is.
 */

import { BlobReader, BlobWriter, ZipReader, type Entry } from '@zip.js/zip.js';
import type { LoadData } from '$lib/functions/file-loaders/types';
import type { Section } from '$lib/data/database/books-db/versions/v4/books-db-v4';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import {
  createComicPageShrinker,
  PAGES_IN_FLIGHT
} from '$lib/functions/file-loaders/utils/shrink-comic-page';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

interface FileEntry {
  filename: string;
  directory: boolean;
  getData(writer: BlobWriter): Promise<Blob>;
}

function naturalCompare(a: string, b: string): number {
  // Split into chunks of (text|number) so "page2" sorts before "page10".
  const re = /(\d+)|(\D+)/g;
  const aTokens = a.toLowerCase().match(re) || [];
  const bTokens = b.toLowerCase().match(re) || [];
  const len = Math.min(aTokens.length, bTokens.length);
  for (let i = 0; i < len; i++) {
    const ax = aTokens[i];
    const bx = bTokens[i];
    const an = /^\d+$/.test(ax);
    const bn = /^\d+$/.test(bx);
    if (an && bn) {
      const d = parseInt(ax, 10) - parseInt(bx, 10);
      if (d !== 0) return d;
    } else if (ax !== bx) {
      return ax < bx ? -1 : 1;
    }
  }
  return aTokens.length - bTokens.length;
}

function mimeFromExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

function extractTitle(opfBuffer: ArrayBuffer | undefined, fallback: string): string {
  // ComicInfo.xml has <Title>X</Title>; if present, prefer it.
  if (!opfBuffer) return fallback;
  const xml = new TextDecoder('utf-8').decode(opfBuffer);
  const m = /<Title>([^<]+)<\/Title>/i.exec(xml);
  return m ? m[1].trim() : fallback;
}

export default async function loadCbz(
  file: File,
  lastBookModified: number,
  onProgress?: (page: number, total: number) => void
): Promise<LoadData> {
  const fallbackTitle = file.name.replace(/\.cbz$/i, '');
  const reader = new ZipReader(new BlobReader(file));
  try {
    const allEntries = (await reader.getEntries()).filter(
      (e: Entry): e is Entry & FileEntry =>
        !e.directory && typeof (e as unknown as FileEntry).getData === 'function'
    ) as unknown as FileEntry[];

    const imageEntries = allEntries
      .filter((e) => IMAGE_RE.test(e.filename))
      .sort((a, b) => naturalCompare(a.filename, b.filename));

    if (!imageEntries.length) {
      throw new Error('CBZ 文件里没有找到图片');
    }

    let title = fallbackTitle;
    const comicInfoEntry = allEntries.find((e) => /comicinfo\.xml$/i.test(e.filename));
    if (comicInfoEntry) {
      try {
        const buf = await (await comicInfoEntry.getData(new BlobWriter('text/xml'))).arrayBuffer();
        title = extractTitle(buf, fallbackTitle);
      } catch {
        // metadata missing/corrupt — keep filename-derived title
      }
    }

    const total = imageEntries.length;
    const sections: Section[] = [];
    const htmlParts: string[] = new Array(total);
    const blobs: Record<string, Blob> = {};
    let coverImage: Blob | undefined;
    let done = 0;

    const shrinker = createComicPageShrinker();
    const pages: Promise<void>[] = [];

    // Pages come out of the archive one at a time — both readers are
    // sequential — but the re-encode goes to a worker pool, so decoding page N
    // overlaps extracting N+1 and the main thread stays free to paint the
    // import progress bar. Shrinks may finish in any order; each page writes
    // its own slot.
    try {
      for (let i = 0; i < total; i++) {
        const entry = imageEntries[i];
        const pageNum = i + 1;
        const ext = entry.filename.slice(entry.filename.lastIndexOf('.') + 1).toLowerCase();
        const mime = mimeFromExt(entry.filename);
        const extracted = await entry.getData(new BlobWriter(mime));

        pages.push(
          shrinker.shrink(extracted, ext).then(({ blob, ext: storedExt }) => {
            const blobName = `cbz-page-${pageNum}.${storedExt}`;
            blobs[blobName] = blob;
            if (pageNum === 1) coverImage = blob;

            const dummySrc = buildDummyBookImage(blobName);
            const id = `cbz-page-${pageNum}`;
            // Match the PDF loader's data-pdf-page convention so the page-dwell
            // tracker (1.10.0) treats CBZ pages identically to PDF pages.
            htmlParts[i] =
              `<div id="${id}" class="cbz-section pdf-section">` +
              `<h3 class="pdf-page-label">${pageNum}</h3>` +
              `<img src="${dummySrc}" alt="第 ${pageNum} 页" class="pdf-page-img book-page-image" ` +
              `data-pdf-page="${pageNum}" loading="lazy" decoding="async" style="max-width:100%;height:auto;" /></div>`;

            done += 1;
            onProgress?.(done, total);
          })
        );

        // Keep extraction from running arbitrarily far ahead of the pool, so
        // only a bounded number of extracted pages is alive at once.
        if (pages.length > PAGES_IN_FLIGHT) await pages[pages.length - 1 - PAGES_IN_FLIGHT];
      }

      await Promise.all(pages);
    } finally {
      shrinker.close();
    }

    for (let i = 0; i < total; i++) {
      sections.push({
        reference: `cbz-page-${i + 1}`,
        charactersWeight: 1,
        label: `第 ${i + 1} 页`,
        startCharacter: i,
        characters: 1
      });
    }

    const totalChars = total;

    const styleSheet =
      '.pdf-section { margin-bottom: 1em; text-align: center; }' +
      '.pdf-page-label { opacity: 0.4; font-size: 0.8em; margin: 1em 0 0.3em; }';

    return {
      title,
      language: 'zh',
      styleSheet,
      elementHtml: htmlParts.join('\n'),
      blobs,
      coverImage,
      hasThumb: false,
      characters: totalChars,
      sections,
      lastBookModified,
      lastBookOpen: 0
    };
  } finally {
    await reader.close();
  }
}
