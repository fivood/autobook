import type { GlossaryEntry } from './glossary.js';
import type { TranslationDocument, TranslationSegment } from './model.js';
import type { TranslationResult } from './provider.js';

export type TranslationJobStatus = 'draft' | 'glossary-review' | 'drafting' | 'review' | 'completed' | 'paused' | 'failed';

export interface TranslationJob {
  id: string;
  documentId: string;
  document: TranslationDocument;
  sourceLanguage: string;
  targetLanguage: string;
  glossary: GlossaryEntry[];
  /** Completed segment outputs, keyed by stable segment id for checkpointing. */
  translations: Record<string, string>;
  completedSegmentIds: string[];
  status: TranslationJobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface CheckpointValidationReport {
  repaired: boolean;
  acceptedTranslations: number;
  droppedSegmentIds: string[];
  warnings: string[];
}

export interface TranslationCheckpointState {
  translations?: Record<string, unknown>;
  completedSegmentIds?: unknown[];
}

export function createJob(
  id: string,
  document: TranslationDocument,
  sourceLanguage: string,
  targetLanguage: string,
  glossary: GlossaryEntry[] = []
): TranslationJob {
  const now = new Date().toISOString();
  return {
    id,
    documentId: document.id,
    document,
    sourceLanguage,
    targetLanguage,
    glossary,
    translations: {},
    completedSegmentIds: [],
    status: 'glossary-review',
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Validate persisted results before resuming a job. A checkpoint can outlive
 * a failed provider request, a browser reload, or a changed document. Only
 * non-empty results for known segment IDs are allowed back into the job.
 */
export function validateTranslationCheckpoint(
  document: TranslationDocument,
  checkpoint: TranslationCheckpointState
): { translations: Record<string, string>; completedSegmentIds: string[]; report: CheckpointValidationReport } {
  const knownIds = new Set(document.segments.map((segment) => segment.id));
  const translations: Record<string, string> = {};
  const droppedSegmentIds: string[] = [];
  const warnings: string[] = [];
  const rawTranslations = checkpoint.translations || {};

  for (const [segmentId, target] of Object.entries(rawTranslations)) {
    if (!knownIds.has(segmentId) || typeof target !== 'string' || !target.trim()) {
      droppedSegmentIds.push(segmentId);
      continue;
    }
    translations[segmentId] = target;
  }

  const completed = new Set<string>();
  for (const value of checkpoint.completedSegmentIds || []) {
    if (typeof value !== 'string' || !knownIds.has(value) || !translations[value]) {
      if (typeof value === 'string') droppedSegmentIds.push(value);
      continue;
    }
    completed.add(value);
  }
  for (const segmentId of Object.keys(translations)) completed.add(segmentId);

  const uniqueDropped = [...new Set(droppedSegmentIds)];
  if (uniqueDropped.length) {
    warnings.push(`丢弃 ${uniqueDropped.length} 个无效或不完整的断点段落。`);
  }
  if (completed.size !== Object.keys(rawTranslations).length || completed.size !== (checkpoint.completedSegmentIds || []).length) {
    warnings.push('断点的翻译表和完成列表已重新同步。');
  }

  return {
    translations,
    completedSegmentIds: [...completed],
    report: {
      repaired: uniqueDropped.length > 0 || warnings.length > 0,
      acceptedTranslations: Object.keys(translations).length,
      droppedSegmentIds: uniqueDropped,
      warnings
    }
  };
}

/** Validate and repair an in-memory job before showing or resuming it. */
export function validateTranslationJob(job: TranslationJob): CheckpointValidationReport {
  const normalized = validateTranslationCheckpoint(job.document, job);
  job.translations = normalized.translations;
  job.completedSegmentIds = normalized.completedSegmentIds;
  for (const segment of job.document.segments) segment.target = job.translations[segment.id];
  if (normalized.report.repaired) job.updatedAt = new Date().toISOString();
  return normalized.report;
}

/** Merge one provider batch into a job checkpoint. */
export function recordTranslationResults(job: TranslationJob, results: TranslationResult[]): TranslationJob {
  const expectedIds = new Set(job.document.segments.map((segment) => segment.id));
  const batchIds = new Set<string>();
  for (const result of results) {
    if (!expectedIds.has(result.segmentId)) throw new Error(`Unknown segment: ${result.segmentId}`);
    if (batchIds.has(result.segmentId)) throw new Error(`Duplicate segment: ${result.segmentId}`);
    if (!result.target.trim()) throw new Error(`Empty translation: ${result.segmentId}`);
    batchIds.add(result.segmentId);
    job.translations[result.segmentId] = result.target;
    if (!job.completedSegmentIds.includes(result.segmentId)) {
      job.completedSegmentIds.push(result.segmentId);
    }
    const segment = job.document.segments.find((candidate) => candidate.id === result.segmentId);
    if (segment) segment.target = result.target;
  }
  job.updatedAt = new Date().toISOString();
  return job;
}

export function setJobStatus(job: TranslationJob, status: TranslationJobStatus, error?: string): TranslationJob {
  job.status = status;
  job.error = error;
  job.updatedAt = new Date().toISOString();
  return job;
}

export function pendingSegments(job: TranslationJob): TranslationSegment[] {
  const completed = new Set(job.completedSegmentIds);
  return job.document.segments.filter((segment) => !completed.has(segment.id));
}
