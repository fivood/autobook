/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import buildDummyBookImage from '../utils/build-dummy-book-image';
import clearAllBadImageRef from '../utils/clear-all-bad-image-ref';
import fixXHtmlHref from '../utils/fix-xhtml-href';
import type { HtmlzContent } from './types';

export function getFormattedElementHtmlz(data: HtmlzContent, document: Document) {
  const regexResult = /.*<body[^>]*>((.|\s)+)<\/body>.*/.exec(data['index.html'])!;
  let html = regexResult[1];
  Object.entries(data)
    .filter(([, value]) => value instanceof Blob)
    .forEach(([key]) => {
      html = html.replaceAll(key, buildDummyBookImage(key));
    });
  // Inert document, for the same reason as generateEpubHtml: parsing untrusted
  // markup into the live one fires `onerror` & co. before any sanitizer runs.
  const result = document.implementation.createHTMLDocument('').createElement('div');
  result.innerHTML = html;

  clearAllBadImageRef(result);
  fixXHtmlHref(result);

  return result;
}
