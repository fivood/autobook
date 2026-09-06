/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Lightweight format inference from a book's stored title (which for
 * imported books usually still carries the original filename's extension).
 * Used by the library filter — see manage/+page.svelte. We deliberately do
 * NOT inspect elementHtml here: that would require pulling the full book
 * blob for every card on every list refresh.
 */

export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'cbz' | 'txt' | 'md' | 'htmlz' | 'other';

const EXT_MAP: Record<string, BookFormat> = {
  pdf: 'pdf',
  epub: 'epub',
  mobi: 'mobi',
  azw: 'mobi',
  azw3: 'mobi',
  kfx: 'mobi',
  cbz: 'cbz',
  cbr: 'cbz',
  cb7: 'cbz',
  cbt: 'cbz',
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  htmlz: 'htmlz'
};

export function detectBookFormat(title: string): BookFormat {
  const lastDot = title.lastIndexOf('.');
  if (lastDot < 0 || lastDot === title.length - 1) return 'other';
  const ext = title.slice(lastDot + 1).toLowerCase();
  return EXT_MAP[ext] || 'other';
}

/**
 * Source container format for the import-time `originalFormat` field. Unlike
 * `detectBookFormat` (which groups every comic archive under `cbz` so the
 * library filter stays single-entry), this keeps the real container so the
 * card badge can show CBR / CB7 / CBT instead of lumping them as CBZ.
 */
export function detectSourceFormat(title: string): string {
  const lastDot = title.lastIndexOf('.');
  if (lastDot < 0 || lastDot === title.length - 1) return 'other';
  const ext = title.slice(lastDot + 1).toLowerCase();
  if (ext === 'cbz' || ext === 'cbr' || ext === 'cb7' || ext === 'cbt') return ext;
  return EXT_MAP[ext] || 'other';
}

/**
 * Drop a trailing known book extension from a display title. Kept beside
 * EXT_MAP so the set of recognized extensions is defined once — the book card
 * used to carry its own inline regex, which had silently drifted and no longer
 * covered comic archives or `.kfx`.
 */
export function stripBookExtension(title: string): string {
  const lastDot = title.lastIndexOf('.');
  if (lastDot < 0 || lastDot === title.length - 1) return title;
  const ext = title.slice(lastDot + 1).toLowerCase();
  return ext in EXT_MAP ? title.slice(0, lastDot) : title;
}

export const BOOK_FORMAT_LABELS: Record<BookFormat, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  mobi: 'MOBI',
  cbz: '漫画',
  txt: 'TXT',
  md: 'Markdown',
  htmlz: 'HTMLZ',
  other: '其他'
};
