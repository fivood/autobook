import { extractTxt } from './extract-txt';
import { loadEpub } from './load-epub';
import { loadMd } from './load-md';

export interface LoadedFile {
  title: string;
  text: string;
  coverDataUrl?: string;
}

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

export async function loadFile(file: File): Promise<LoadedFile> {
  const name = file.name;
  const lower = name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');

  const isEpubByMime = /epub\+zip/i.test(file.type);
  const isEpubByExt = lower.endsWith('.epub');
  if (isEpubByExt || isEpubByMime || (await isZipMagic(file))) {
    const epub = await loadEpub(file);
    return { title: epub.title || stem, text: epub.text, coverDataUrl: epub.coverDataUrl };
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { title: stem, text: await loadMd(file) };
  }
  return { title: stem, text: await extractTxt(file) };
}
