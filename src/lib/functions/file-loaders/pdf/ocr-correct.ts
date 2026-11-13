/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * OCR post-correction: feed the recognised text layer through a language
 * model to fix the errors PaddleOCR reliably makes on printed books —
 * confused glyphs (己/已/巳, 未/末, rn/m), dropped punctuation, spurious
 * spaces inside CJK runs.
 *
 * Only the transparent text layer changes. The page image the reader
 * actually looks at is untouched, so correction improves selection, copy,
 * search, TTS pronunciation and the AI assistant's BM25 index — not the
 * visual page. That also means a bad correction is cheap to live with and
 * trivially re-runnable, unlike an edit to real book content.
 *
 * String-level rewriting, deliberately: 1.17.4/1.17.5 established that
 * DOMParser on a whole `elementHtml` silently truncates 800+ page books.
 * The text layer's shape is regular enough to match directly.
 */

/** One recognised line — the unit both OCR and correction work in. */
export interface OcrTextLine {
  /** Position in the flattened span list for the whole book. Stable key. */
  index: number;
  /** 0-based page ordinal, for progress reporting and batch grouping. */
  pageIndex: number;
  text: string;
}

const TEXT_LAYER_RE = /<div\s+class="pdf-text-layer"[^>]*>([\s\S]*?)<\/div>/g;
// Spans carry escaped text and no nested tags, so a non-greedy body match
// is safe here in a way it would not be for arbitrary book HTML.
const SPAN_RE = /<span\s+style="([^"]*)">([\s\S]*?)<\/span>/g;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function extractOcrLines(html: string): OcrTextLine[] {
  const lines: OcrTextLine[] = [];
  let index = 0;
  let pageIndex = 0;

  TEXT_LAYER_RE.lastIndex = 0;
  let layerMatch: RegExpExecArray | null;
  while ((layerMatch = TEXT_LAYER_RE.exec(html)) !== null) {
    const body = layerMatch[1] ?? '';
    SPAN_RE.lastIndex = 0;
    let spanMatch: RegExpExecArray | null;
    while ((spanMatch = SPAN_RE.exec(body)) !== null) {
      const text = decodeEntities(spanMatch[2] ?? '').trim();
      // Every span keeps its slot even when empty so `index` stays aligned
      // with the rewrite pass below; empty ones are simply never sent.
      if (text) lines.push({ index, pageIndex, text });
      index += 1;
    }
    pageIndex += 1;
  }

  return lines;
}

function readPx(style: string, prop: string): number {
  const match = new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`).exec(style);
  return match ? Number(match[1]) : 0;
}

/**
 * Rebuild a span's style for replacement text.
 *
 * The original `letter-spacing` was derived from the *recognised* character
 * count (see itemsToTextLayer in pdf-ocr-runner): the span is stretched to
 * the source bounding box by spreading the slack between characters. A
 * correction that changes the character count invalidates that value — keep
 * it and the selection rectangle drifts away from the ink underneath. So the
 * spacing is recomputed from the same formula with the new count.
 */
function restyleForText(style: string, text: string): string {
  const width = readPx(style, 'width');
  const fontSize = readPx(style, 'font-size');
  const withoutSpacing = style.replace(/;?\s*letter-spacing\s*:\s*[^;]*/g, '');
  if (!width || !fontSize) return withoutSpacing;

  const charCount = [...text].length;
  const naturalWidth = charCount * fontSize;
  const extraSpacing = charCount > 1 ? Math.max(0, (width - naturalWidth) / (charCount - 1)) : 0;
  return extraSpacing > 0.5
    ? `${withoutSpacing};letter-spacing:${extraSpacing.toFixed(2)}px`
    : withoutSpacing;
}

export interface ApplyResult {
  html: string;
  applied: number;
}

/**
 * Write corrections back, keyed by the `index` handed out by extractOcrLines.
 * Spans not present in the map are left byte-identical.
 */
export function applyOcrCorrections(html: string, corrections: Map<number, string>): ApplyResult {
  if (!corrections.size) return { html, applied: 0 };

  let index = 0;
  let applied = 0;

  TEXT_LAYER_RE.lastIndex = 0;
  const nextHtml = html.replace(TEXT_LAYER_RE, (layer, body: string) => {
    SPAN_RE.lastIndex = 0;
    const nextBody = body.replace(SPAN_RE, (span, style: string, rawText: string) => {
      const current = index;
      index += 1;
      const replacement = corrections.get(current);
      if (replacement === undefined) return span;
      const trimmed = replacement.trim();
      // An empty correction would destroy a selectable line; treat it as
      // "model had nothing to say" and keep the original.
      if (!trimmed || trimmed === decodeEntities(rawText).trim()) return span;
      applied += 1;
      return `<span style="${restyleForText(style, trimmed)}">${escapeHtml(trimmed)}</span>`;
    });
    return layer.replace(body, nextBody);
  });

  return { html: nextHtml, applied };
}

/**
 * Group lines into model requests. Batches stay within a character budget and
 * never straddle pages: a page is the natural context unit, and keeping the
 * boundary there means a failed batch only costs one page of work.
 */
export function batchOcrLines(lines: readonly OcrTextLine[], maxChars = 1200): OcrTextLine[][] {
  const batches: OcrTextLine[][] = [];
  let current: OcrTextLine[] = [];
  let chars = 0;
  let page = -1;

  for (const line of lines) {
    const wouldOverflow = chars + line.text.length > maxChars && current.length > 0;
    if (line.pageIndex !== page || wouldOverflow) {
      if (current.length) batches.push(current);
      current = [];
      chars = 0;
      page = line.pageIndex;
    }
    current.push(line);
    chars += line.text.length;
  }
  if (current.length) batches.push(current);

  return batches;
}

export function buildCorrectionSystemPrompt(): string {
  return [
    '你是 OCR 后处理器。输入是从扫描书页识别出的文本行，其中有识别错误。',
    '你的任务只有一个：修正识别错误，还原印刷原文。',
    '严格规则：',
    '1. 只改明显的识别错误——形近字（己/已/巳、未/末、日/曰）、错误拆合、',
    '   漏掉的标点、CJK 之间多出来的空格、误认的英文字母（rn→m、l→1）。',
    '2. 不要翻译、不要改写、不要润色、不要补全残缺的句子。',
    '3. 不确定就原样返回该行。宁可漏改，不可改错。',
    '4. 行数必须与输入完全一致，id 必须原样回传，不得合并或拆分行。',
    '5. 一行本来就正确时，原样返回。',
    '仅输出 JSON：{"lines":[{"id":<数字>,"text":"修正后的该行"}]}'
  ].join('\n');
}

export function buildCorrectionUserPrompt(batch: readonly OcrTextLine[]): string {
  return JSON.stringify(batch.map((line) => ({ id: line.index, text: line.text })));
}

/**
 * Parse one batch response. Anything the model invents — unknown ids, dropped
 * lines, non-strings — is discarded rather than written back; a partial batch
 * is fine because untouched lines simply keep their OCR text.
 */
export function parseCorrectionResponse(
  raw: string,
  batch: readonly OcrTextLine[]
): Map<number, string> {
  const allowed = new Set(batch.map((line) => line.index));
  const out = new Map<number, string>();

  const text = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!text) return out;

  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const rows = (parsed as { lines?: unknown })?.lines;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const value = row as { id?: unknown; text?: unknown };
      const id = typeof value.id === 'number' ? value.id : Number(value.id);
      if (!Number.isFinite(id) || !allowed.has(id)) continue;
      if (typeof value.text !== 'string') continue;
      const corrected = value.text.trim();
      if (!corrected) continue;
      out.set(id, corrected);
    }
    if (out.size) return out;
  }

  return out;
}

/**
 * Guard against a model that rewrites instead of correcting. A correction
 * whose length moved far from the source is almost always a translation, a
 * summary, or a hallucinated continuation — dropping it costs one uncorrected
 * line, keeping it corrupts the text layer.
 */
export function isPlausibleCorrection(original: string, corrected: string): boolean {
  if (!corrected) return false;
  const from = [...original].length;
  const to = [...corrected].length;
  if (from === 0) return false;
  const ratio = to / from;
  return ratio >= 0.5 && ratio <= 1.8;
}
