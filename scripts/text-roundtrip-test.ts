import { TextAdapter } from '../src/adapters/text.ts';
import { chunkSegmentsByChars, translateInBatches } from '../src/core/batch.ts';

const adapter = new TextAdapter('markdown');
const sourcePath = 'demo.md';
const source = '# Demo\n\nA small paragraph.\nStill the same paragraph.\n\nSecond paragraph.';
const document = await adapter.extract({ sourcePath, bytes: new TextEncoder().encode(source) });
if (document.segments.length !== 3) throw new Error(`Expected 3 Markdown segments, got ${document.segments.length}.`);

const first = document.segments[0];
if (!first || first.kind !== 'heading') throw new Error('Markdown heading was not classified.');
const bytes = await adapter.export(document, [
  { segmentId: first.id, source: first.source, target: '# 已翻译' }
]);
const output = new TextDecoder().decode(bytes);
if (!output.startsWith('# 已翻译\n\n')) throw new Error('Text round-trip replacement was not preserved.');

const chunks = chunkSegmentsByChars(document.segments, 10, 20);
if (chunks.length !== 3 || chunks.some((chunk) => chunk.length !== 1)) {
  throw new Error(`Character-budget batching failed: ${chunks.length} chunks.`);
}

const incompleteProvider = {
  id: 'incomplete-test-provider',
  kind: 'local' as const,
  healthCheck: async () => ({ ok: true, message: 'ok' }),
  listModels: async () => [],
  translate: async (request: { segments: readonly typeof document.segments[number][] }) => [
    { segmentId: request.segments[0]!.id, target: 'only one result' }
  ]
};
let incompleteRejected = false;
try {
  await translateInBatches(document.segments, {
    provider: incompleteProvider,
    model: 'test',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    glossary: [],
    batchSize: 2
  });
} catch (error) {
  incompleteRejected = error instanceof Error && error.message.includes('missing:');
}
if (!incompleteRejected) throw new Error('Incomplete provider output was not rejected.');

console.log(JSON.stringify({ format: document.format, segments: document.segments.length, output }));
