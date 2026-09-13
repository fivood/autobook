/**
 * Comic OCR post-correction: feed bubble text through an LLM to fix the
 * errors PaddleOCR reliably makes on manga — confused glyphs (己/已/巳,
 * 未/末, rn/m), dropped punctuation, spurious spaces inside CJK runs, and
 * mis-segmented furigana. Runs after OCR and before the document is built,
 * so the translated segments start from cleaner source text.
 *
 * Only the bubble *text* changes — the page image and the poly coordinates
 * are untouched, so a bad correction is cheap to live with and re-runnable.
 * Mirrors the printed-book flow in ocr-correct.ts; that one rewrites an HTML
 * text layer, this one rewrites in-memory ComicBubble[] on its way into the
 * ComicAdapter.
 */

import type { AiClientOpts } from '$lib/data/ai/ai-client';
import { chatOnce } from '$lib/data/ai/ai-client';
import type { ComicBubble } from 'translator-workbench';
import { isPlausibleCorrection } from '$lib/functions/file-loaders/pdf/ocr-correct';

export interface ComicCorrectionProgress {
  batch: number;
  totalBatches: number;
  corrected: number;
  totalBubbles: number;
}

export function buildComicCorrectionSystemPrompt(): string {
  return [
    '你是漫画 OCR 后处理器。输入是从漫画页识别出的气泡/文字块文本，其中有识别错误。',
    '你的任务只有一个：修正识别错误，还原印刷原文。',
    '严格规则：',
    '1. 只改明显的识别错误——形近字（己/已/巳、未/末、日/曰）、日文汉字与假名混淆、',
    '   错误拆合、漏掉的标点、CJK 之间多出来的空格、误认的英文字母（rn→m、l→1）。',
    '2. 不要翻译、不要改写、不要润色、不要补全残缺的句子。',
    '3. 保留拟声词（効果音）、感叹词与对话口语的原有形式，不确定就原样返回。',
    '4. id 必须原样回传，数量与输入完全一致，不得合并或拆分行。',
    '5. 一行本来就正确时，原样返回。',
    '仅输出 JSON：{"lines":[{"id":"气泡id","text":"修正后的该行"}]}'
  ].join('\n');
}

export function parseComicCorrectionResponse(
  raw: string,
  batch: readonly ComicBubble[]
): Map<string, string> {
  const allowed = new Set(batch.map((bubble) => bubble.id));
  const out = new Map<string, string>();

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
      if (typeof value.id !== 'string' || !allowed.has(value.id)) continue;
      if (typeof value.text !== 'string') continue;
      const corrected = value.text.trim();
      if (!corrected) continue;
      out.set(value.id, corrected);
    }
    if (out.size) return out;
  }

  return out;
}

/**
 * Group bubbles into model requests. Batches stay within a character budget
 * and never straddle pages — the natural context unit, so a failed batch
 * only costs one page of correction work.
 */
export function batchComicBubbles(
  bubbles: readonly ComicBubble[],
  maxChars = 1200
): ComicBubble[][] {
  const batches: ComicBubble[][] = [];
  let current: ComicBubble[] = [];
  let chars = 0;
  let page = -1;

  for (const bubble of bubbles) {
    const wouldOverflow = chars + bubble.text.length > maxChars && current.length > 0;
    if (bubble.pageIndex !== page || wouldOverflow) {
      if (current.length) batches.push(current);
      current = [];
      chars = 0;
      page = bubble.pageIndex;
    }
    current.push(bubble);
    chars += bubble.text.length;
  }
  if (current.length) batches.push(current);

  return batches;
}

export async function correctComicBubbles(
  bubbles: readonly ComicBubble[],
  opts: AiClientOpts,
  signal?: AbortSignal,
  onProgress?: (progress: ComicCorrectionProgress) => void
): Promise<ComicBubble[]> {
  if (!bubbles.length) return [...bubbles];

  const batches = batchComicBubbles(bubbles);
  const sourceById = new Map(bubbles.map((bubble) => [bubble.id, bubble.text]));
  const corrected = new Map<string, string>();

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    if (!batch) continue;
    if (signal?.aborted) break;

    try {
      const raw = await chatOnce(opts, {
        system: buildComicCorrectionSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: JSON.stringify(batch.map((bubble) => ({ id: bubble.id, text: bubble.text })))
          }
        ],
        maxTokens: 2048,
        jsonMode: true,
        signal
      });
      const parsed = parseComicCorrectionResponse(raw, batch);
      for (const [id, text] of parsed) {
        const original = sourceById.get(id);
        // Same length-ratio guard as the printed-book flow: a "correction"
        // far from the source is a rewrite, not a fix. Dropping it costs one
        // uncorrected bubble.
        if (original && isPlausibleCorrection(original, text)) {
          corrected.set(id, text);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // A single bad batch must not sink the run — the remaining bubbles are
      // still worth correcting, and untouched ones keep their OCR text.
    }

    onProgress?.({
      batch: i + 1,
      totalBatches: batches.length,
      corrected: corrected.size,
      totalBubbles: bubbles.length
    });
  }

  return bubbles.map((bubble) => {
    const replacement = corrected.get(bubble.id);
    return replacement !== undefined ? { ...bubble, text: replacement } : bubble;
  });
}
