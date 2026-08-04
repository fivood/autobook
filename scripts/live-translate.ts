import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  EpubAdapter,
  OllamaProvider,
  createJob,
  extractGlossaryCandidates,
  pendingSegments,
  recordTranslationResults,
  setJobStatus,
  validateTranslationCheckpoint,
  translateInBatches
} from '../dist/index.js';
import type { GlossaryEntry, TranslationDocument } from '../dist/index.js';

interface LiveCheckpoint {
  version: 1;
  sourcePath: string;
  documentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossary: GlossaryEntry[];
  translations: Record<string, unknown>;
  completedSegmentIds: string[];
  status: string;
  error?: string;
  updatedAt: string;
}

const positionalArgs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const inputPath = positionalArgs[0];
if (!inputPath) throw new Error('Usage: node --experimental-strip-types scripts/live-translate.ts <input.epub> [output-dir] [model] [glossary.json]');

const absoluteInput = resolve(inputPath);
const outputDir = resolve(positionalArgs[1] || join(dirname(absoluteInput), 'translation-output'));
const model = positionalArgs[2] || 'qwen2.5:14b';
const glossaryPath = positionalArgs[3] ? resolve(positionalArgs[3]) : undefined;
const targetLanguage = process.env.TRANSLATOR_TARGET_LANGUAGE || 'zh-CN';
const batchSize = Number(process.env.TRANSLATOR_BATCH_SIZE || 3);
const maxRetries = Number(process.env.TRANSLATOR_MAX_RETRIES || 3);
const validateOnly = process.argv.includes('--validate');
const sourceName = basename(absoluteInput, extname(absoluteInput));
const checkpointPath = join(outputDir, `${sourceName}.job.json`);
const candidatePath = join(outputDir, `${sourceName}.glossary-candidates.json`);
const outputPath = join(outputDir, `${sourceName}.draft.${targetLanguage}.epub`);

async function loadGlossary(): Promise<GlossaryEntry[]> {
  if (!glossaryPath) return [];
  const parsed: unknown = JSON.parse(await readFile(glossaryPath, 'utf8'));
  const entries = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries) ? (parsed as { entries: unknown[] }).entries : []);
  return entries.filter((entry): entry is GlossaryEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const value = entry as Partial<GlossaryEntry>;
    return typeof value.source === 'string' && typeof value.target === 'string' && value.target.trim().length > 0;
  }).map((entry) => ({
    id: entry.id || `glossary-${entry.source}`,
    source: entry.source,
    target: entry.target,
    rule: entry.rule || 'preferred',
    note: entry.note,
    caseSensitive: entry.caseSensitive,
    approved: true
  }));
}

async function saveCheckpoint(document: TranslationDocument, job: ReturnType<typeof createJob>): Promise<void> {
  const checkpoint: LiveCheckpoint = {
    version: 1,
    sourcePath: absoluteInput,
    documentId: document.id,
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    glossary: job.glossary,
    translations: job.translations,
    completedSegmentIds: job.completedSegmentIds,
    status: job.status,
    error: job.error,
    updatedAt: job.updatedAt
  };
  const temporaryPath = `${checkpointPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, JSON.stringify(checkpoint, null, 2), 'utf8');
  await rename(temporaryPath, checkpointPath);
}

const bytes = new Uint8Array(await readFile(absoluteInput));
const adapter = new EpubAdapter();
const document = await adapter.extract({ sourcePath: absoluteInput, bytes });
const glossary = await loadGlossary();
await mkdir(outputDir, { recursive: true });

const candidates = extractGlossaryCandidates(document.segments, { minOccurrences: 2, maxCandidates: 200 });
await writeFile(candidatePath, JSON.stringify({ sourcePath: absoluteInput, documentId: document.id, entries: glossary, candidates }, null, 2), 'utf8');

const job = createJob(`live-${document.id}`, document, document.sourceLanguage || 'en', targetLanguage, glossary);
let checkpointWarnings: string[] = [];
try {
  const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as LiveCheckpoint;
  if (checkpoint.version === 1 && checkpoint.documentId === document.id) {
    const normalized = validateTranslationCheckpoint(document, checkpoint);
    checkpointWarnings = normalized.report.warnings;
    recordTranslationResults(job, Object.entries(normalized.translations)
      .map(([segmentId, target]) => ({ segmentId, target })));
    job.glossary = checkpoint.glossary;
    console.log(`Resuming ${sourceName}: ${job.completedSegmentIds.length}/${document.segments.length} segments`);
    if (checkpointWarnings.length) console.log(`Checkpoint repaired: ${checkpointWarnings.join(' ')}`);
  }
} catch {
  // No checkpoint yet; start from the first segment.
}

if (validateOnly) {
  if (checkpointWarnings.length) {
    setJobStatus(job, 'paused');
    await saveCheckpoint(document, job);
  }
  console.log(JSON.stringify({ status: 'validated', documentId: document.id, completed: job.completedSegmentIds.length, total: document.segments.length, warnings: checkpointWarnings }));
  process.exit(0);
}

setJobStatus(job, 'drafting');
await saveCheckpoint(document, job);
const provider = new OllamaProvider({ timeoutMs: Number(process.env.TRANSLATOR_TIMEOUT_MS || 120000) });
const abortController = new AbortController();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  abortController.abort();
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
console.log(JSON.stringify({ input: absoluteInput, output: outputPath, model, sourceLanguage: job.sourceLanguage, targetLanguage, segments: document.segments.length, sourceChars: document.segments.reduce((total, segment) => total + segment.source.length, 0), glossaryEntries: job.glossary.length }));

try {
  await translateInBatches(pendingSegments(job), {
    provider,
    model,
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    glossary: job.glossary,
    batchSize,
    maxSourceChars: 12000,
    maxRetries,
    retryDelayMs: 2000,
    signal: abortController.signal,
    onBatchComplete: async (batch, index, count) => {
      recordTranslationResults(job, batch);
      await saveCheckpoint(document, job);
      console.log(`batch ${index + 1}/${count}: ${job.completedSegmentIds.length}/${document.segments.length}`);
    }
  });
  setJobStatus(job, 'completed');
  await saveCheckpoint(document, job);
  const replacements = document.segments
    .filter((segment) => job.translations[segment.id] !== undefined)
    .map((segment) => ({ segmentId: segment.id, source: segment.source, target: job.translations[segment.id] || '' }));
  const output = await adapter.export(document, replacements);
  await writeFile(outputPath, output);
  console.log(JSON.stringify({ status: 'completed', outputPath, translatedSegments: replacements.length, checkpointPath, candidatePath }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (interrupted || abortController.signal.aborted) {
    setJobStatus(job, 'paused');
    await saveCheckpoint(document, job);
    console.log(`Translation paused safely at ${job.completedSegmentIds.length}/${document.segments.length}.`);
  } else {
    setJobStatus(job, 'failed', message);
    await saveCheckpoint(document, job);
    console.error(`Translation failed: ${message}`);
    process.exitCode = 1;
  }
}
