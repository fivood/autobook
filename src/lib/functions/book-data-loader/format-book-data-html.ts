/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { Observable } from 'rxjs';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { isElementGaiji } from '$lib/functions/is-element-gaiji';
import { map } from 'rxjs/operators';
import { sanitizeHtml } from '$lib/functions/sanitize-html';
import {
  readerImageGalleryPictures$,
  type ReaderImageGalleryPicture
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';

export default function formatBookDataHtml(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  return getHtmlWithImageSource(bookData, isPaginated).pipe(
    map((elementHtml) => {
      const element = document.createElement('div');
      // Last line of defense before book markup reaches the live document.
      // Books imported by older versions were stored unsanitized, so this has
      // to happen on every render, not just at import.
      element.innerHTML = sanitizeHtml(elementHtml);

      addImageContainerClass(element);
      // combineImagePairs(element);
      removeSvgDimensions(element);
      addSpoilerTags(element, document, blurMode);
      removeOldBrTagSolution(element);
      stripInlineColor(element);

      return element.innerHTML;
    })
  );
}

function getHtmlWithImageSource(bookData: BooksDbBookData, isPaginated: boolean) {
  return new Observable<string>((subscriber) => {
    const { blobs } = bookData;
    const objectUrls: string[] = [];
    const urlIndexes = new Map<string, number>();

    let { elementHtml } = bookData;

    const pdfPageUrls = new Set<string>();

    Object.entries(blobs).forEach(([key, value]) => {
      const url = URL.createObjectURL(
        value.type
          ? value
          : new Blob([value], { type: BaseStorageHandler.getImageMimeTypeFromExtension(key) })
      );
      const dummyUrl = buildDummyBookImage(key);

      objectUrls.push(url);
      urlIndexes.set(url, elementHtml.indexOf(dummyUrl));
      if (/^pdf-page-\d+\.jpg$/.test(key)) pdfPageUrls.add(url);

      elementHtml = elementHtml.replaceAll(dummyUrl, url).replaceAll(`ttu:${key}`, url);
    });
    subscriber.next(elementHtml);

    const readerImageGalleryPictures: ReaderImageGalleryPicture[] = objectUrls.map((url) => ({
      url,
      unspoilered: !isPaginated || pdfPageUrls.has(url)
    }));

    readerImageGalleryPictures.sort((picture1, picture2) => {
      const index1 = urlIndexes.get(picture1.url) || 0;
      const index2 = urlIndexes.get(picture2.url) || 0;

      return index1 - index2;
    });

    readerImageGalleryPictures$.next(readerImageGalleryPictures);

    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  });
}

function addImageContainerClass(el: HTMLElement) {
  Array.from(el.getElementsByTagName('img'))
    .map((imgEl) => ({ parentEl: imgEl.parentElement, isGaiji: isElementGaiji(imgEl) }))
    .forEach(({ parentEl, isGaiji }) => {
      parentEl?.classList.add('ttu-img-container');

      if (!isGaiji) {
        parentEl?.classList.add('ttu-illustration-container');
      }
    });
}

function removeSvgDimensions(el: HTMLElement) {
  Array.from(el.getElementsByTagName('svg')).forEach((tag) => {
    tag.removeAttribute('width');
    tag.removeAttribute('height');
  });
}

function isInlineImage(img: HTMLImageElement): boolean {
  const parent = img.parentElement;
  if (!parent) return false;
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function addSpoilerTags(el: HTMLElement, document: Document, blurMode: BlurMode) {
  if (blurMode === BlurMode.NONE) return;

  const getNonCoverChildren = () => {
    const childNodes = [...el.children];
    // Expose only the very first child (the front cover the user picked) and
    // blur everything else — including back cover, title page, synopsis, TOC,
    // forewords, and chapter bodies. Back cover with spoilery blurbs is
    // common front-matter, so blanket exposing "front matter" is unsafe.
    //
    // If the first child is already long-form text (>200 chars), it's chapter
    // content rather than a cover, so don't grant it the exception.
    const firstLen = childNodes[0]?.textContent?.trim().length || 0;
    return firstLen >= 200 ? childNodes : childNodes.slice(1);
  };

  const createWrapper = (tag: Element, childNode: Element) => {
    const imgWrapper = document.createElement('span');
    const parentElement = tag.parentElement || childNode;

    imgWrapper.classList.add('ttu-img-parent');
    imgWrapper.toggleAttribute('data-ttu-spoiler-img');

    parentElement.insertBefore(imgWrapper, tag);
    imgWrapper.appendChild(tag);
  };

  (blurMode === BlurMode.AFTER_TOC
    ? getNonCoverChildren()
    : [...el.children]
  ).forEach((childNode) => {
    Array.from(childNode.getElementsByTagName('img'))
      .filter((tag) => !isElementGaiji(tag) && !tag.hasAttribute('data-pdf-page') && !isInlineImage(tag))
      .forEach((tag) => createWrapper(tag, childNode));

    Array.from(childNode.getElementsByTagName('svg'))
      .filter((tag) => tag.getElementsByTagName('image').length)
      .forEach((tag) => createWrapper(tag, childNode));
  });
}

function removeOldBrTagSolution(el: HTMLElement) {
  el.querySelectorAll('.placeholder-br').forEach((placeholderEl) => {
    placeholderEl.parentElement!.removeChild(placeholderEl);
  });
}

function stripInlineColor(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>('[style]').forEach((node) => {
    const cleaned = node
      .getAttribute('style')!
      .replace(/(^|;)\s*color\s*:\s*[^;]*/gi, '$1')
      .replace(/^;+|;+$/g, '')
      .trim();
    if (cleaned) node.setAttribute('style', cleaned);
    else node.removeAttribute('style');
  });
  el.querySelectorAll('font[color]').forEach((node) => node.removeAttribute('color'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function combineImagePairs(el: HTMLElement) {
  const imagePairs: [Element, Element][] = [];

  let startingIndex = 1;

  if (el.children.item(0)?.id.startsWith('ttu-')) {
    // Skip first page (index 0) as it's probably cover
    startingIndex = 2;
  }

  for (let i = startingIndex; i < el.children.length; i += 2) {
    const leftChild = el.children.item(i - 1)!;
    const rightChild = el.children.item(i)!;

    if (
      hasNoText(leftChild) &&
      hasNoText(rightChild) &&
      hasSingleImage(leftChild) &&
      hasSingleImage(rightChild)
    ) {
      imagePairs.push([leftChild, rightChild]);
    }
  }

  if (
    imagePairs.some(([leftPair, rightPair]) => {
      const leftImages = leftPair.querySelectorAll('image');
      const rightImages = rightPair.querySelectorAll('image');

      if (leftImages.length !== 1 || rightImages.length !== 1) {
        // Not supported
        return true;
      }

      if (!isImagePortrait(leftImages[0]) || !isImagePortrait(rightImages[0])) {
        return true;
      }

      return false;
    })
  ) {
    return;
  }

  imagePairs.forEach(([leftPair, rightPair]) => {
    el.removeChild(rightPair);

    leftPair.classList.add('grouped-image');

    const images = extractImageChildren(leftPair).concat(extractImageChildren(rightPair));

    clearChildren(leftPair);

    images.forEach((image) => leftPair.appendChild(image));
  });
}

function hasNoText(el: Element) {
  return typeof el.textContent === 'string' ? el.textContent.trim().length === 0 : !el.textContent;
}

function getImageChildren(el: Element) {
  const imageChilds = el.querySelectorAll('svg');
  return imageChilds;
}

function hasSingleImage(el: Element) {
  return getImageChildren(el).length === 1;
}

function extractImageChildren(el: Element) {
  const imageChildren = getImageChildren(el);
  const result: Element[] = [];
  imageChildren.forEach((child) => {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
      result.push(child);
    }
  });
  return result;
}

function clearChildren(el: Element) {
  Array.from(el.children).forEach((child) => {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
  });
  return el;
}

function isImagePortrait(el: SVGImageElement) {
  return el.height.baseVal.value > el.width.baseVal.value;
}
