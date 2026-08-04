import { translateInBatches } from '../src/core/batch.ts';
import { validateTranslationCheckpoint } from '../src/core/job.ts';

const document = {
  id: 'doc',
  sourcePath: 'book.epub',
  format: 'epub' as const,
  segments: [
    { id: 'a', documentId: 'doc', filePath: 'chapter.xhtml', start: 0, end: 1, source: 'A', kind: 'text' as const, contextPath: 'body' },
    { id: 'b', documentId: 'doc', filePath: 'chapter.xhtml', start: 1, end: 2, source: 'B', kind: 'text' as const, contextPath: 'body' }
  ],
  metadata: {},
  state: {}
};

const result = validateTranslationCheckpoint(document, {
  translations: { a: '甲', b: '', unknown: '丢弃' },
  completedSegmentIds: ['a', 'a', 'b', 'unknown']
});

if (Object.keys(result.translations).join(',') !== 'a') throw new Error('Checkpoint kept an invalid translation.');
if (result.completedSegmentIds.join(',') !== 'a') throw new Error('Checkpoint completion list was not repaired.');
if (!result.report.repaired || result.report.droppedSegmentIds.length !== 2) throw new Error('Checkpoint repair report is incomplete.');

const controller = new AbortController();
controller.abort();
try {
  await translateInBatches(document.segments, {
    provider: {
      id: 'test',
      kind: 'local',
      healthCheck: async () => ({ ok: true, message: 'ok' }),
      listModels: async () => [],
      translate: async () => []
    },
    model: 'test',
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    glossary: [],
    signal: controller.signal,
    maxRetries: 3
  });
  throw new Error('Aborted translation did not stop immediately.');
} catch (error) {
  if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
}

console.log(JSON.stringify({ status: 'ok', accepted: result.report.acceptedTranslations, dropped: result.report.droppedSegmentIds, abort: 'safe' }));
