/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ExtractedBookMetadata, LoadData } from '../types';
import extractEpub from './extract-epub';
import generateEpubHtml from './generate-epub-html';
import generateEpubStyleSheet from './generate-epub-style-sheet';
import getEpubCoverImageFilename from './get-epub-cover-image-filename';
import { isOPFType } from './types';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';
import { detectLanguage } from '$lib/functions/file-loaders/detect-language';

/**
 * A Dublin Core element is either a bare string or an object carrying the
 * value under `#text` plus attributes (`opf:role`, `opf:scheme`, `id`…),
 * and any of them may appear once or many times. Every reader below has to
 * cope with both shapes; that is the only reason these helpers exist.
 */
function readDcText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text.trim() || undefined;
    if (typeof text === 'number') return String(text);
  }
  return undefined;
}

function readDcTexts(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];

  for (const item of items) {
    const text = readDcText(item);
    if (text) out.push(text);
  }

  return out;
}

function extractOpfMetadata(metadata: unknown): ExtractedBookMetadata | undefined {
  // `metadata` is typed as the OPF-required subset (dc:title / dc:language),
  // but real files carry the rest of Dublin Core, so index dynamically.
  const bag = metadata as Record<string, unknown>;
  const extracted: ExtractedBookMetadata = {};

  // Multiple creators are joined rather than dropped: the authors tab groups
  // by exact string, and "A, B" is a truer bucket than silently picking A.
  const authors = readDcTexts(bag['dc:creator']);
  if (authors.length) extracted.author = authors.join(', ');

  const publisher = readDcTexts(bag['dc:publisher'])[0];
  if (publisher) extracted.publisher = publisher;

  const subjects = readDcTexts(bag['dc:subject']);
  if (subjects.length) extracted.subjects = subjects;

  // dc:identifier holds whatever the publisher felt like — UUIDs, DOIs, the
  // occasional ISBN. Prefer one that says so; otherwise take none rather
  // than mislabel a UUID as an ISBN.
  const isbn = readDcTexts(bag['dc:identifier']).find((value) => /isbn/i.test(value));
  if (isbn) extracted.isbn = isbn;

  // dc:date is loosely specified (full ISO timestamps, bare years, and
  // "2013-05" all occur), so only the leading 4-digit year is trusted.
  for (const date of readDcTexts(bag['dc:date'])) {
    const year = Number(/^(\d{4})/.exec(date)?.[1]);
    if (year >= 1000 && year <= 9999) {
      extracted.publishedYear = year;
      break;
    }
  }

  return Object.keys(extracted).length ? extracted : undefined;
}

export default async function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number
): Promise<LoadData> {
  const { contents, result: data, contentsDirectory } = await extractEpub(file);
  const result = generateEpubHtml(data, contents, document, contentsDirectory);

  const displayData = {
    title: file.name,
    language: '',
    hasThumb: true,
    styleSheet: generateEpubStyleSheet(data, contents)
  };

  let extractedMetadata: ExtractedBookMetadata | undefined;

  const metadata = isOPFType(contents)
    ? contents['opf:package']['opf:metadata']
    : contents.package.metadata;

  if (metadata) {
    const languageValues = Array.isArray(metadata['dc:language'])
      ? metadata['dc:language']
      : [metadata['dc:language']];
    const titleValues = Array.isArray(metadata['dc:title'])
      ? metadata['dc:title']
      : [metadata['dc:title']];

    for (const dcTitle of titleValues) {
      if (typeof dcTitle === 'string') {
        displayData.title = dcTitle;
        break;
      } else if (dcTitle && dcTitle['#text']) {
        displayData.title = dcTitle['#text'];
        break;
      }
    }

    displayData.language =
      languageValues.reduce((languages, dcLanguage) => {
        try {
          if (typeof dcLanguage === 'string') {
            languages.push(...Intl.getCanonicalLocales(dcLanguage.trim()));
          } else if (dcLanguage && typeof dcLanguage['#text'] === 'string') {
            // `<dc:language id="lang">en</dc:language>` parses to an object;
            // this branch used to call .trim() on the object itself, throw,
            // and lose the language to the empty catch below.
            languages.push(...Intl.getCanonicalLocales(dcLanguage['#text'].trim()));
          }
        } catch (_) {
          //no-op
        }

        return languages;
      }, [])?.[0] || '';

    extractedMetadata = extractOpfMetadata(metadata);
  }

  if (!displayData.language) {
    // Was a flat 'ja'. That is upstream's audience, not this app's, and it is
    // not cosmetic: the TTS voice is picked per language, so this fallback
    // decides how an untagged book gets read aloud. The text itself is right
    // here and says more than a guess about the reader.
    displayData.language = detectLanguage(result.element.textContent || '');
  }

  const blobData = reduceObjToBlobs(data);
  const coverImageFilename = await getEpubCoverImageFilename(blobData, contents);
  let coverImage: Blob | undefined;

  if (coverImageFilename) {
    coverImage = blobData[coverImageFilename];
  }

  return {
    ...displayData,
    elementHtml: result.element.innerHTML,
    blobs: blobData,
    coverImage,
    characters: result.characters,
    sections: result.sections,
    lastBookModified,
    lastBookOpen: 0,
    // Language is resolved after extraction (it has its own fallback), so
    // fold the final value in here rather than inside extractOpfMetadata.
    _extractedMetadata: extractedMetadata && {
      ...extractedMetadata,
      language: displayData.language
    }
  };
}
