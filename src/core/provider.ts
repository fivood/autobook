import type { GlossaryEntry } from './glossary.js';
import type { TranslationSegment } from './model.js';

export interface ModelInfo {
  id: string;
  size?: number;
  modifiedAt?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
}

export interface TranslationRequest {
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: readonly TranslationSegment[];
  glossary: readonly GlossaryEntry[];
  styleGuide?: string;
  neighboringSegments?: readonly TranslationSegment[];
  signal?: AbortSignal;
}

export interface TranslationResult {
  segmentId: string;
  target: string;
  raw?: unknown;
}

export interface TranslationProvider {
  readonly id: string;
  readonly kind: 'local' | 'remote' | 'codex';
  healthCheck(signal?: AbortSignal): Promise<ProviderHealth>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  translate(request: TranslationRequest): Promise<TranslationResult[]>;
}
