/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LoadData } from '../types';
import extractEpub from './extract-epub';
import generateEpubHtml from './generate-epub-html';
import generateEpubStyleSheet from './generate-epub-style-sheet';
import getEpubCoverImageFilename from './get-epub-cover-image-filename';
import { isOPFType } from './types';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';

export default async function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number
): Promise<LoadData> {
  const { contents, result: data, contentsDirectory } = await extractEpub(file);
  const result = generateEpubHtml(data, contents, document, contentsDirectory);

  const displayData: {
    title: string;
    language: string;
    hasThumb: boolean;
    styleSheet: string;
    _extractedMetadata?: {
      author?: string;
      publisher?: string;
      subjects?: string[];
      isbn?: string;
      language?: string;
    };
  } = {
    title: file.name,
    language: '',
    hasThumb: true,
    styleSheet: generateEpubStyleSheet(data, contents)
  };

  const readDcText = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    if (value && typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
      const t = (value as Record<string, unknown>)['#text'];
      if (typeof t === 'string') return t.trim() || undefined;
    }
    return undefined;
  };
  const readAllDcTexts = (value: unknown): string[] => {
    const arr = Array.isArray(value) ? value : [value];
    const out: string[] = [];
    for (const item of arr) {
      const t = readDcText(item);
      if (t) out.push(t);
    }
    return out;
  };

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
          } else if (dcLanguage && dcLanguage['#text']) {
            languages.push(...Intl.getCanonicalLocales(dcLanguage.trim()));
          }
        } catch (_) {
          //no-op
        }

        return languages;
      }, [])?.[0] || '';

    const extracted: NonNullable<typeof displayData._extractedMetadata> = {};
    // `metadata` is typed as the OPF-required subset (dc:title / dc:language);
    // real files carry many more Dublin Core fields, so index dynamically.
    const bag = metadata as Record<string, unknown>;

    const authors = readAllDcTexts(bag['dc:creator']);
    if (authors.length) extracted.author = authors.join(', ');

    const publisherRaw = Array.isArray(bag['dc:publisher'])
      ? (bag['dc:publisher'] as unknown[])[0]
      : bag['dc:publisher'];
    const publisher = readDcText(publisherRaw);
    if (publisher) extracted.publisher = publisher;

    const subjects = readAllDcTexts(bag['dc:subject']);
    if (subjects.length) extracted.subjects = subjects;

    const identifiers = readAllDcTexts(bag['dc:identifier']);
    const isbn = identifiers.find((v) => /isbn/i.test(v)) || identifiers[0];
    if (isbn) extracted.isbn = isbn;

    if (Object.keys(extracted).length) {
      if (displayData.language) extracted.language = displayData.language;
      displayData._extractedMetadata = extracted;
    }
  }

  if (!displayData.language) {
    displayData.language = 'ja';
    console.warn(`no language data found for ${file.name} - fallback to ja`);
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
    lastBookOpen: 0
  };
}
