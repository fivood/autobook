import { readFile } from 'node:fs/promises';
import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js';
import { EpubAdapter } from '../src/adapters/epub.ts';

configure({ useWebWorkers: false });

const root = process.env.TRANSLATOR_TEST_EPUB_DIR || 'G:/trans/Amello-Novellas';
const names = ['Amber.epub', 'DragonClan.epub', 'King_Part1.epub', 'King_Part2.epub', 'Mercurio.epub', 'Sana.epub', 'Thane.epub'];
const adapter = new EpubAdapter();

for (const name of names) {
  const sourcePath = `${root}/${name}`;
  const document = await adapter.extract({ sourcePath, bytes: new Uint8Array(await readFile(sourcePath)) });
  const first = document.segments[0];
  const output = await adapter.export(document, first ? [{ segmentId: first.id, source: first.source, target: first.source }] : []);
  const reparsed = await adapter.extract({ sourcePath: `compat://${name}`, bytes: output });
  if (reparsed.segments.length !== document.segments.length) {
    throw new Error(`${name}: exported EPUB re-parsed with ${reparsed.segments.length} segments; expected ${document.segments.length}.`);
  }
  // zip.js returns a Uint8Array<ArrayBufferLike>; normalize it to a plain
  // ArrayBuffer so this test also type-checks with newer TypeScript DOM libs.
  const outputBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  const reader = new ZipReader(new BlobReader(new Blob([outputBuffer])));
  const entries = await reader.getEntries();
  const hasTitlepage = entries.some((entry) => entry.filename === 'titlepage.xhtml');
  const opfEntry = entries.find((entry) => entry.filename === document.metadata.opfPath);
  const opfXml = opfEntry?.getData ? await opfEntry.getData(new TextWriter()) : '';
  const hasManifestTitlepage = /<[^>]*item\b[^>]*href=["'][^"']*titlepage\.xhtml["'][^>]*media-type=["']application\/xhtml\+xml["'][^>]*\/>/i.test(opfXml);
  await reader.close();
  if (!hasTitlepage) throw new Error(`${name}: exported EPUB is missing the titlepage.xhtml compatibility entry.`);
  if (!hasManifestTitlepage) throw new Error(`${name}: exported OPF is missing the titlepage.xhtml manifest entry.`);
  console.log(JSON.stringify({ name, segments: document.segments.length, entries: entries.length, hasTitlepage, hasManifestTitlepage }));
}
