import type { DocumentAdapter, DocumentFormat, DocumentSource, SegmentReplacement, TranslationDocument, TranslationSegment } from '../core/model.js';

type TextAdapterFormat = 'txt' | 'markdown';

interface TextArchiveState {
  text: string;
  encoding: 'utf-8';
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function detectLanguage(text: string): string {
  const sample = text.slice(0, 4000);
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (sample.match(/[a-z]/gi) || []).length;
  if (kana > 10) return 'ja';
  if (latin > cjk) return 'en';
  if (cjk > 0) return 'zh';
  return 'unknown';
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function makeSegments(text: string, documentId: string, format: TextAdapterFormat): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const blockPattern = /[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g;
  for (const match of text.matchAll(blockPattern)) {
    const raw = match[0] || '';
    const rawStart = match.index || 0;
    const leading = raw.search(/\S/);
    const source = raw.trim();
    if (!source || leading < 0) continue;
    const start = rawStart + leading;
    const end = start + source.length;
    const kind = format === 'markdown' && /^#{1,6}\s/.test(source) ? 'heading' : 'text';
    segments.push({
      id: `text_${fnv1a(`${documentId}:${start}:${source}`)}`,
      documentId,
      filePath: documentId,
      start,
      end,
      source,
      kind,
      contextPath: format
    });
  }
  return segments;
}

export class TextAdapter implements DocumentAdapter {
  readonly format: DocumentFormat;

  constructor(format: TextAdapterFormat = 'txt') {
    this.format = format;
  }

  async extract(source: DocumentSource): Promise<TranslationDocument> {
    const text = decode(source.bytes);
    const documentId = `text_${fnv1a(source.sourcePath)}`;
    const format = this.format;
    const segments = makeSegments(text, documentId, format as TextAdapterFormat);
    return {
      id: documentId,
      sourcePath: source.sourcePath,
      format,
      title: source.sourcePath.split(/[\\/]/).pop() || source.sourcePath,
      sourceLanguage: detectLanguage(text),
      segments,
      metadata: { encoding: 'utf-8' },
      state: { text, encoding: 'utf-8' } satisfies TextArchiveState
    };
  }

  async export(document: TranslationDocument, replacements: SegmentReplacement[]): Promise<Uint8Array> {
    const state = document.state as TextArchiveState;
    if (!state || typeof state.text !== 'string') throw new Error('Text document archive state is missing.');
    let output = state.text;
    const byStart = [...replacements].sort((left, right) => {
      const leftSegment = document.segments.find((segment) => segment.id === left.segmentId);
      const rightSegment = document.segments.find((segment) => segment.id === right.segmentId);
      return (rightSegment?.start || 0) - (leftSegment?.start || 0);
    });
    for (const replacement of byStart) {
      const segment = document.segments.find((candidate) => candidate.id === replacement.segmentId);
      if (!segment) throw new Error(`Unknown segment: ${replacement.segmentId}`);
      if (output.slice(segment.start, segment.end) !== replacement.source) {
        throw new Error(`Source text changed for segment ${replacement.segmentId}.`);
      }
      output = `${output.slice(0, segment.start)}${replacement.target}${output.slice(segment.end)}`;
    }
    return new TextEncoder().encode(output);
  }
}
