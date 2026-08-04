import type { DocumentAdapter, DocumentFormat, DocumentSource, SegmentReplacement, TranslationDocument, TranslationSegment } from '../core/model.js';

interface HtmlArchiveState {
  html: string;
  encoding: 'utf-8';
}

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'math', 'pre', 'code']);
const BLOCK_TAGS = new Set(['article', 'section', 'div', 'p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

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

function extractSegments(html: string, documentId: string): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const tokenPattern = /<\/?([a-z][^\s/>]*)\b[^>]*>|([^<]+)/gi;
  const skipDepth = new Map<string, number>();
  const blockStack: string[] = [];
  for (const match of html.matchAll(tokenPattern)) {
    const tag = match[1]?.toLowerCase();
    if (tag) {
      const closing = /^<\//.test(match[0]);
      if (SKIP_TAGS.has(tag)) {
        const nextDepth = (skipDepth.get(tag) || 0) + (closing ? -1 : 1);
        if (nextDepth > 0) skipDepth.set(tag, nextDepth);
        else skipDepth.delete(tag);
      }
      if (BLOCK_TAGS.has(tag)) {
        if (closing) {
          const last = blockStack.lastIndexOf(tag);
          if (last >= 0) blockStack.splice(last, 1);
        } else if (!/\/\s*>$/.test(match[0])) {
          blockStack.push(tag);
        }
      }
      continue;
    }
    if ([...skipDepth.values()].some((depth) => depth > 0)) continue;
    const raw = match[2] || '';
    const rawStart = match.index || 0;
    const source = raw.trim();
    if (!source) continue;
    const leading = raw.search(/\S/);
    const start = rawStart + leading;
    const end = start + source.length;
    const blockTag = blockStack[blockStack.length - 1];
    const heading = blockTag?.match(/^h([1-6])$/);
    segments.push({
      id: `html_${fnv1a(`${documentId}:${start}:${source}`)}`,
      documentId,
      filePath: 'index.html',
      start,
      end,
      source,
      kind: heading ? 'heading' : 'text',
      contextPath: blockStack.length ? `html:${blockStack.join('/')}` : 'html'
    });
  }
  return segments;
}

export interface MarkdownChunk {
  filename: string;
  text: string;
  segmentIds: string[];
}

export interface MarkdownChunkOptions {
  maxChars?: number;
  basename?: string;
}

/** Render an HTML translation document into review-friendly Markdown chunks. */
export function exportHtmlAsMarkdownChunks(
  document: TranslationDocument,
  replacements: readonly SegmentReplacement[],
  options: MarkdownChunkOptions = {}
): MarkdownChunk[] {
  const maxChars = options.maxChars ?? 24000;
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('maxChars must be a positive integer.');
  const replacementById = new Map(replacements.map((replacement) => [replacement.segmentId, replacement.target]));
  const chunks: MarkdownChunk[] = [];
  let text = '';
  let segmentIds: string[] = [];
  let previous: TranslationSegment | undefined;

  const flush = () => {
    if (!text) return;
    const index = String(chunks.length + 1).padStart(3, '0');
    const basename = options.basename || document.title || 'translated';
    chunks.push({ filename: `${basename}.part-${index}.md`, text: `${text.trim()}\n`, segmentIds });
    text = '';
    segmentIds = [];
  };

  for (const segment of document.segments) {
    const raw = replacementById.get(segment.id) ?? segment.target ?? segment.source;
    const heading = segment.kind === 'heading' ? `#`.repeat(Number(segment.contextPath.match(/h([1-6])$/)?.[1] || 1)) + ' ' : '';
    const value = `${heading}${raw}`;
    const separator = !previous ? '' : previous.contextPath === segment.contextPath ? ' ' : '\n\n';
    if (text && text.length + separator.length + value.length > maxChars) flush();
    text += `${text ? separator : ''}${value}`;
    segmentIds.push(segment.id);
    previous = segment;
  }
  flush();
  return chunks;
}

export class HtmlAdapter implements DocumentAdapter {
  readonly format: DocumentFormat = 'html';

  async extract(source: DocumentSource): Promise<TranslationDocument> {
    const html = new TextDecoder('utf-8').decode(source.bytes).replace(/^\uFEFF/, '');
    const documentId = `html_${fnv1a(source.sourcePath)}`;
    return {
      id: documentId,
      sourcePath: source.sourcePath,
      format: this.format,
      title: source.sourcePath.split(/[\\/]/).pop() || source.sourcePath,
      sourceLanguage: detectLanguage(html),
      segments: extractSegments(html, documentId),
      metadata: { encoding: 'utf-8' },
      state: { html, encoding: 'utf-8' } satisfies HtmlArchiveState
    };
  }

  async export(document: TranslationDocument, replacements: SegmentReplacement[]): Promise<Uint8Array> {
    const state = document.state as HtmlArchiveState;
    if (!state || typeof state.html !== 'string') throw new Error('HTML document archive state is missing.');
    let output = state.html;
    const ordered = [...replacements].sort((left, right) => {
      const leftSegment = document.segments.find((segment) => segment.id === left.segmentId);
      const rightSegment = document.segments.find((segment) => segment.id === right.segmentId);
      return (rightSegment?.start || 0) - (leftSegment?.start || 0);
    });
    for (const replacement of ordered) {
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
