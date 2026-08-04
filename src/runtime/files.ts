import { readFile, writeFile } from 'node:fs/promises';
import { EpubAdapter } from '../adapters/epub.js';
import type { SegmentReplacement, TranslationDocument } from '../core/model.js';

/** Node/Tauri-side convenience wrappers. The adapter itself stays browser-safe. */
export async function extractEpubFile(sourcePath: string): Promise<TranslationDocument> {
  const bytes = new Uint8Array(await readFile(sourcePath));
  return new EpubAdapter().extract({ sourcePath, bytes });
}

export async function exportEpubFile(
  document: TranslationDocument,
  replacements: SegmentReplacement[],
  outputPath: string
): Promise<void> {
  const bytes = await new EpubAdapter().export(document, replacements);
  await writeFile(outputPath, bytes);
}
