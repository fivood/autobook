/**
 * Whether a book has text the spoiler-safe AI assistant can actually index.
 *
 * The assistant builds a BM25 index over `elementHtml` (see book-text-index).
 * Comics (CBZ/CBR) and scanned PDFs that haven't been OCR'd carry no text
 * layer — the index would be empty, so every answer degenerates to "还没读
 * 到，不能剧透". Those books hide the AI entry point instead of offering a
 * dead drawer.
 *
 * Reuses the same markers the reader already has:
 *  - `cbz-section` => comic archive, image-by-design
 *  - `isScannedPdf` => scanned PDF with no usable text layer yet
 * Once OCR lands, `pdf-text-layer` appears and isScannedPdf flips to false,
 * so the AI button naturally comes back without any per-book bookkeeping.
 */
import { isScannedPdf } from '$lib/functions/file-loaders/pdf/pdf-ocr-runner';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';

export function hasIndexableText(book: Pick<BooksDbBookData, 'elementHtml' | 'sections'>): boolean {
  const html = book.elementHtml || '';
  if (/class="cbz-section/.test(html)) return false;
  if (isScannedPdf(book)) return false;
  return true;
}

/**
 * A comic archive (CBZ/CBR/CB7/CBT). Distinct from a scanned PDF: comics are
 * image-by-design, never get the PDF OCR banner, and the full-book OCR +
 * translation banner is their dedicated entry point.
 */
export function isComicBook(book: Pick<BooksDbBookData, 'elementHtml'>): boolean {
  return /class="cbz-section/.test(book.elementHtml || '');
}
