import { extractTxt } from './extract-txt';
import { loadEpub } from './load-epub';
import { loadMd } from './load-md';
import { loadPdf, type ParsedPdf } from './load-pdf';
import type { BookFormat } from './book-format';

/** Reflowable text books (txt / epub / md) take the typewriter path:
 * concatenated plain text + chapter starts. PDFs take the page-scroll
 * path: per-page rendered images + optional positioned text layer. The
 * discriminator lets the caller switch reader UI without sniffing
 * filename twice. */
export interface LoadedText {
  kind: 'text';
  format: BookFormat;
  title: string;
  text: string;
  coverDataUrl?: string;
  /** EPUB only: image asset key → blob, and footnote id → body text. The
   * text carries their positions as sentinels (see parse-text.ts). */
  images?: Map<string, Blob>;
  notes?: Map<string, string>;
}

export type LoadedFile = LoadedText | { kind: 'pdf'; format: 'pdf'; pdf: ParsedPdf };

async function isZipMagic(file: File): Promise<boolean> {
  // EPUB is a ZIP. iOS share-sheet often strips or renames the extension
  // (e.g. dropped from an email or downloaded via a non-standard app), so
  // we sniff the first 4 bytes instead of trusting the filename.
  // ZIP local file header signature: PK\x03\x04 (0x50 0x4b 0x03 0x04).
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  } catch {
    return false;
  }
}

async function isPdfMagic(file: File): Promise<boolean> {
  // PDF starts with %PDF (0x25 0x50 0x44 0x46). Same iOS share-sheet
  // reasoning as ZIP — extension can be missing.
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  } catch {
    return false;
  }
}

export async function loadFile(
  file: File,
  onPdfProgress?: (loaded: number, total: number) => void
): Promise<LoadedFile> {
  const name = file.name;
  const lower = name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');

  const isPdfByMime = /^application\/pdf/i.test(file.type);
  const isPdfByExt = lower.endsWith('.pdf');
  if (isPdfByExt || isPdfByMime || (await isPdfMagic(file))) {
    const pdf = await loadPdf(file, onPdfProgress);
    if (!pdf.title) pdf.title = stem;
    return { kind: 'pdf', format: 'pdf', pdf };
  }

  const isEpubByMime = /epub\+zip/i.test(file.type);
  const isEpubByExt = lower.endsWith('.epub');
  if (isEpubByExt || isEpubByMime || (await isZipMagic(file))) {
    const epub = await loadEpub(file);
    return {
      kind: 'text',
      format: 'epub',
      title: epub.title || stem,
      text: epub.text,
      coverDataUrl: epub.coverDataUrl,
      images: epub.images,
      notes: epub.notes
    };
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { kind: 'text', format: 'md', title: stem, text: await loadMd(file) };
  }
  return { kind: 'text', format: 'txt', title: stem, text: await extractTxt(file) };
}
