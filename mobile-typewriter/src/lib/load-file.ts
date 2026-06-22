import { extractTxt } from './extract-txt';
import { loadEpub } from './load-epub';
import { loadMd } from './load-md';

export interface LoadedFile {
  title: string;
  text: string;
}

export async function loadFile(file: File): Promise<LoadedFile> {
  const name = file.name;
  const lower = name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');

  if (lower.endsWith('.epub')) {
    const epub = await loadEpub(file);
    return { title: epub.title || stem, text: epub.text };
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { title: stem, text: await loadMd(file) };
  }
  return { title: stem, text: await extractTxt(file) };
}
