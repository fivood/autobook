import { mkdir, readFile } from 'node:fs/promises';
import { EpubAdapter } from '../src/adapters/epub.ts';

const sourcePath = process.env.TRANSLATOR_TEST_EPUB || 'G:/trans/Amello-Novellas/Thane.epub';
const outputPath = 'G:/translator-workbench/.tmp/Thane.roundtrip.epub';

await mkdir('G:/translator-workbench/.tmp', { recursive: true });
const adapter = new EpubAdapter();
const document = await adapter.extract({ sourcePath, bytes: new Uint8Array(await readFile(sourcePath)) });
if (!document.segments.length) throw new Error('No translatable EPUB segments found.');

const first = document.segments[0];
if (!first) throw new Error('Missing first segment.');
const outputBytes = await adapter.export(document, [{ segmentId: first.id, source: first.source, target: `${first.source} [TEST]` }]);
await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, outputBytes));

const exported = await readFile(outputPath);
if (!exported.length) throw new Error('Round-trip EPUB is empty.');
const check = await adapter.extract({ sourcePath: outputPath, bytes: new Uint8Array(exported) });
const changed = check.segments.find((segment) => segment.filePath === first.filePath && segment.start === first.start);
if (!changed || !changed.source.endsWith(' [TEST]')) {
  throw new Error('Round-trip replacement was not found in exported EPUB.');
}

console.log(JSON.stringify({
  sourcePath,
  outputPath,
  documentId: document.id,
  title: document.title,
  sourceLanguage: document.sourceLanguage,
  segments: document.segments.length,
  firstSegment: { id: first.id, filePath: first.filePath, source: first.source }
}, null, 2));
