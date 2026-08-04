import type { GlossaryEntry } from './glossary.js';
import type { TranslationProvider, TranslationRequest, TranslationResult } from './provider.js';
import type { TranslationSegment } from './model.js';

export function chunkSegments(segments: readonly TranslationSegment[], batchSize = 12): TranslationSegment[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer.');
  const chunks: TranslationSegment[][] = [];
  for (let index = 0; index < segments.length; index += batchSize) {
    chunks.push([...segments.slice(index, index + batchSize)]);
  }
  return chunks;
}

/** Chunk by both segment count and approximate source character budget. */
export function chunkSegmentsByChars(
  segments: readonly TranslationSegment[],
  batchSize = 12,
  maxSourceChars = 12000
): TranslationSegment[][] {
  if (!Number.isInteger(maxSourceChars) || maxSourceChars < 1) {
    throw new Error('maxSourceChars must be a positive integer.');
  }
  const chunks: TranslationSegment[][] = [];
  let current: TranslationSegment[] = [];
  let currentChars = 0;
  for (const segment of segments) {
    const wouldExceedChars = current.length > 0 && currentChars + segment.source.length > maxSourceChars;
    if (current.length >= batchSize || wouldExceedChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += segment.source.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export interface BatchTranslationOptions {
  provider: TranslationProvider;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossary: readonly GlossaryEntry[];
  styleGuide?: string;
  batchSize?: number;
  /** Approximate source character budget per model request. */
  maxSourceChars?: number;
  /** Retry a failed provider response without checkpointing the batch. */
  maxRetries?: number;
  /** Delay before the first retry; subsequent retries back off linearly. */
  retryDelayMs?: number;
  signal?: AbortSignal;
  onBatchComplete?: (results: TranslationResult[], batchIndex: number, batchCount: number) => void | Promise<void>;
}

export async function translateInBatches(
  segments: readonly TranslationSegment[],
  options: BatchTranslationOptions
): Promise<TranslationResult[]> {
  const batches = options.maxSourceChars
    ? chunkSegmentsByChars(segments, options.batchSize, options.maxSourceChars)
    : chunkSegments(segments, options.batchSize);
  const maxRetries = options.maxRetries ?? 0;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error('maxRetries must be a non-negative integer.');
  const allResults: TranslationResult[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    if (options.signal?.aborted) {
      const error = new Error('Translation aborted.');
      error.name = 'AbortError';
      throw error;
    }
    const batch = batches[index];
    if (!batch) continue;
    const request: TranslationRequest = {
      model: options.model,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      segments: batch,
      glossary: options.glossary,
      styleGuide: options.styleGuide,
      signal: options.signal
    };
    let results: TranslationResult[] = [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        results = await options.provider.translate(request);
        const expectedIds = new Set(batch.map((segment) => segment.id));
        const returnedIds = new Set<string>();
        for (const result of results) {
          if (!expectedIds.has(result.segmentId)) throw new Error(`Provider returned an unknown segment: ${result.segmentId}`);
          if (returnedIds.has(result.segmentId)) throw new Error(`Provider returned a duplicate segment: ${result.segmentId}`);
          if (!result.target.length) throw new Error(`Provider returned an empty translation: ${result.segmentId}`);
          returnedIds.add(result.segmentId);
        }
        if (returnedIds.size !== expectedIds.size) {
          const missing = [...expectedIds].filter((segmentId) => !returnedIds.has(segmentId));
          throw new Error(`Provider returned ${returnedIds.size}/${expectedIds.size} translations; missing: ${missing.join(', ')}`);
        }
        break;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (attempt >= maxRetries) throw error;
        const delay = Math.max(0, options.retryDelayMs ?? 1000) * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    allResults.push(...results);
    await options.onBatchComplete?.(results, index, batches.length);
  }
  return allResults;
}
