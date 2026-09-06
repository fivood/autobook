/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js';
import {
  isOPFType,
  type EpubContent,
  type EpubOPFContent,
  type EpubSpineItemRef
} from './types';

import type { Entry } from '@zip.js/zip.js';
import { XMLParser } from 'fast-xml-parser';
import initZipSettings from '../utils/init-zip-settings';
import pLimit from 'p-limit';
import path from 'path-browserify';

initZipSettings();

export default async function extractEpub(blob: Blob) {
  const reader = new ZipReader(new BlobReader(blob));
  // get all entries from the zip
  const entries = await reader.getEntries();

  const result: Record<string, string | Blob> = {};
  let contentsDirectory = '';
  let contents!: EpubContent | EpubOPFContent;
  if (entries.length) {
    const fileMap = entries.reduce<Record<string, Entry>>((acc, cur) => {
      acc[cur.filename] = cur;
      return acc;
    }, {});

    const containerXml = await fileMap['META-INF/container.xml'].getData!(new TextWriter());
    const parser = new XMLParser({
      ignoreAttributes: false
    });
    const container = parser.parse(containerXml);
    const rootFiles = container.container.rootfiles.rootfile;
    const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;

    const contentOpfFilename = rootFile['@_full-path'];

    const contentsXml = await fileMap[contentOpfFilename].getData!(new TextWriter());
    result[contentOpfFilename] = contentsXml;

    contentsDirectory = path.dirname(contentOpfFilename);

    contents = parser.parse(contentsXml);

    // fast-xml-parser collapses a single child element into an object instead
    // of a one-element array — the same trap `rootfiles.rootfile` is
    // normalised for above. The declared type claims `EpubSpineItemRef[]`, so
    // the compiler can't catch it: a one-chapter EPUB (short works, generated
    // files, samples) threw "itemref.map is not a function" and failed import.
    const rawSpineItemRefs: EpubSpineItemRef[] | EpubSpineItemRef | undefined = isOPFType(contents)
      ? contents['opf:package']['opf:spine']?.['opf:itemref']
      : contents.package.spine?.itemref;
    const spineItemRefs = !rawSpineItemRefs
      ? []
      : Array.isArray(rawSpineItemRefs)
        ? rawSpineItemRefs
        : [rawSpineItemRefs];
    // An unreadable spine must not read as "nothing is in the spine" — that
    // would make every missing file non-critical and quietly turn a truncated
    // EPUB into an empty book. With no spine, don't apply the spine test.
    const spineIds = spineItemRefs.length
      ? new Set(spineItemRefs.map((item) => item['@_idref']))
      : undefined;

    // Bound decompression concurrency — image-heavy EPUBs otherwise inflate
    // every manifest entry at once and spike memory/jank the main thread.
    // Same pLimit(3) ceiling the PDF loader uses for page rendering.
    const limiter = pLimit(3);
    await Promise.all(
      (isOPFType(contents)
        ? contents['opf:package']['opf:manifest']['opf:item']
        : contents.package.manifest.item
      ).map((item) =>
        limiter(async () => {
          const fileRelativePath = item['@_href'];
          // OCF requires hrefs in content.opf to be percent-encoded while zip entry
          // names are stored as raw UTF-8 — try the encoded form first, then decoded.
          let entry = fileMap[path.join(contentsDirectory, fileRelativePath)];

          if (!entry) {
            try {
              entry = fileMap[path.join(contentsDirectory, decodeURIComponent(fileRelativePath))];
            } catch {
              // malformed percent-encoding — fall through to the not-found handling
            }
          }

          if (!entry) {
            const mediaType: string = item['@_media-type'] || '';
            const isNonCritical =
              mediaType.startsWith('image/') ||
              mediaType.startsWith('font/') ||
              mediaType.startsWith('audio/') ||
              mediaType.startsWith('video/') ||
              mediaType === 'text/css' ||
              mediaType === 'application/vnd.ms-opentype' ||
              mediaType === 'application/font-woff' ||
              (!!spineIds && !spineIds.has(item['@_id']));

            if (isNonCritical) {
              console.warn(`[epub] skipping missing resource: ${fileRelativePath}`);
              return;
            }
            throw new Error(`item ${fileRelativePath} not found`);
          }

          if (entry.getData && !entry.directory) {
            let value: string | Blob;
            const mediaType: string = item['@_media-type'];
            if (mediaType.startsWith('image/')) {
              value = await entry.getData(new BlobWriter(mediaType));
            } else {
              value = await entry.getData(new TextWriter());
            }
            result[fileRelativePath] = value;
          }
        })
      )
    );
  }

  await reader.close();
  return {
    contentsDirectory,
    contents,
    result
  };
}
