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

export const BOOK_FORMAT_LABELS: Record<BookFormat, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  mobi: 'MOBI',
  cbz: 'CBZ',
  txt: 'TXT',
  md: 'Markdown',
  htmlz: 'HTMLZ',
  other: '其他'
};
