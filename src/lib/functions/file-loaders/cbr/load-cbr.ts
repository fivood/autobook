/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * CBR / CB7 / CBT loader — comic archives that aren't ZIP. CBR is RAR,
 * CB7 is 7-Zip, CBT is tar. zip.js can't read any of them, so we lean on
 * libarchive.js (libarchive compiled to WASM). The wasm is dynamically
 * imported so importing a CBZ doesn't pay the ~1MB cost.
 *
 * Output shape is identical to load-cbz.ts: one section per image, using
 * the `pdf-page-img` / `data-pdf-page` convention so the page tracker,
 * PDF context menu, image zoom, and OCR runner all treat these books the
 * same as a scanned PDF.
 */

import type { LoadData } from '$lib/functions/file-loaders/types';
import type { Section } from '$lib/data/database/books-db/versions/v4/books-db-v4';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { pagePath } from '$lib/data/env';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

function naturalCompare(a: string, b: string): number {
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

function extractTitle(xml: string, fallback: string): string {
  const m = /<Title>([^<]+)<\/Title>/i.exec(xml);
  return m ? m[1].trim() : fallback;
}

export default async function loadCbr(file: File, lastBookModified: number): Promise<LoadData> {
  const fallbackTitle = file.name.replace(/\.(cbr|cb7|cbt|rar|7z|tar)$/i, '');

  // libarchive.js is a worker-backed WASM module. The worker file fetches
  // libarchive.wasm as its sibling, so we serve both as static assets from
  // /vendor/libarchive/ — Vite's `?worker` / `?url` import patterns don't
  // reliably preserve the wasm sibling relationship across dev vs. prod
  // builds. The pair is copied into static/vendor/libarchive/ at install
  // time and from there to /build/vendor/libarchive/ on production builds.
  const { Archive } = await import('libarchive.js');
  Archive.init({
    getWorker: () =>
      new Worker(`${pagePath}/vendor/libarchive/worker-bundle.js`, { type: 'module' })
  });

  const archive = await Archive.open(file);
  try {
    const entries = await archive.getFilesArray();
    // entries: Array<{ file: CompressedFile, path: string }>; file.name is
    // basename, full path is `${path}${file.name}`.
    interface ArchiveFile {
      name: string;
      extract(): Promise<File>;
    }
    interface Entry {
      file: ArchiveFile;
      path: string;
    }
    const all = entries as Entry[];

    const imageEntries = all
      .filter((e) => IMAGE_RE.test(e.file.name))
      .sort((a, b) => naturalCompare(a.path + a.file.name, b.path + b.file.name));

    if (!imageEntries.length) {
      throw new Error('压缩包里没有找到图片，不是有效的漫画归档');
    }

    let title = fallbackTitle;
    const comicInfo = all.find((e) => /comicinfo\.xml$/i.test(e.file.name));
    if (comicInfo) {
      try {
        const xmlFile = await comicInfo.file.extract();
        const xml = await xmlFile.text();
        title = extractTitle(xml, fallbackTitle);
      } catch {
        // metadata missing/corrupt — keep filename-derived title
      }
    }

    const sections: Section[] = [];
    const htmlParts: string[] = [];
    const blobs: Record<string, Blob> = {};
    let totalChars = 0;
    let coverImage: Blob | undefined;

    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i];
      const pageNum = i + 1;
      const ext = entry.file.name.slice(entry.file.name.lastIndexOf('.') + 1).toLowerCase();
      const mime = mimeFromExt(entry.file.name);
      // Re-wrap as a Blob with the correct mime — extract() returns a File
      // tagged application/octet-stream which would otherwise reach the
      // <img> as the wrong type and fail to render in some browsers.
      const raw = await entry.file.extract();
      const blob = new Blob([await raw.arrayBuffer()], { type: mime });
      // Reuse the cbz-page-* blob key prefix so the OCR runner finds
      // images identically (it already probes both pdf-page-N and
      // cbz-page-N keys).
      const blobName = `cbz-page-${pageNum}.${ext}`;
      blobs[blobName] = blob;
      if (pageNum === 1) coverImage = blob;

      const dummySrc = buildDummyBookImage(blobName);
      const id = `cbz-page-${pageNum}`;
      htmlParts.push(
        `<div id="${id}" class="cbz-section pdf-section">` +
          `<h3 class="pdf-page-label">${pageNum}</h3>` +
          `<img src="${dummySrc}" alt="第 ${pageNum} 页" class="pdf-page-img book-page-image" ` +
          `data-pdf-page="${pageNum}" loading="lazy" decoding="async" style="max-width:100%;height:auto;" /></div>`
      );
      sections.push({
        reference: id,
        charactersWeight: 1,
        label: `第 ${pageNum} 页`,
        startCharacter: totalChars,
        characters: 1
      });
      totalChars += 1;
    }

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
    await archive.close();
  }
}
