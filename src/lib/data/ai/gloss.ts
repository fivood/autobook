/**
 * Contextual gloss — what a word means *in this sentence*.
 *
 * The offline StarDict lookup already answers "what can this word mean": it
 * returns every sense the dictionary knows. What it cannot do is pick the one
 * in play here, which is exactly where readers get stuck — classical Chinese,
 * dialect, a technical term borrowed into prose, or a common word used oddly.
 *
 * That makes this the cheapest possible first LLM feature: the request is one
 * sentence long, a 1.5B model handles it, and when no model is configured the
 * dictionary still answers on its own. Nothing regresses when it is absent.
 */

import { chatOnce, type AiClientOpts } from '$lib/data/ai/ai-client';

export interface GlossRequest {
  word: string;
  /** The sentence the word was selected in. Empty falls back to word-only. */
  sentence: string;
  bookTitle?: string;
  /** Dictionary senses, when the offline lookup found any. Grounds the answer. */
  dictionarySenses?: string[];
  signal?: AbortSignal;
}

export interface GlossResult {
  meaning: string;
  /** Present when the model judged the usage worth a note (irony, archaism…). */
  note?: string;
}

/** Sentence-ish boundaries for CJK and Latin punctuation alike. */
const SENTENCE_BREAK = /[。．.！!？?；;\n]/;

/**
 * Pull the sentence containing `offset` out of a longer text. Bounded so a
 * chapter without punctuation cannot send an unbounded prompt.
 */
export function extractSentence(text: string, offset: number, maxChars = 220): string {
  if (!text) return '';
  const clamped = Math.max(0, Math.min(offset, text.length));

  let start = clamped;
  while (start > 0 && clamped - start < maxChars && !SENTENCE_BREAK.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  let end = clamped;
  while (end < text.length && end - clamped < maxChars && !SENTENCE_BREAK.test(text[end] ?? '')) {
    end += 1;
  }
  // Keep the terminator so the model sees a complete sentence.
  if (end < text.length) end += 1;

  return text.slice(start, end).trim();
}

function buildSystemPrompt(): string {
  return [
    '你是一个阅读助手，只做一件事：解释某个词在给定句子中的含义。',
    '规则：',
    '1. 只解释这个词在这句话里的意思，不要罗列它的所有义项。',
    '2. 解释要短——一句话，最多两句。',
    '3. 如果提供了词典义项，从中选出符合语境的那个；都不符合时才自己给。',
    '4. 不要复述原句，不要翻译整句，不要展开与该词无关的内容。',
    '5. 只有当用法确实特别（反讽、古义、方言、专业借用）时才给 note，否则省略。',
    '仅输出 JSON：{"meaning":"在此句中的含义","note":"可选的用法提示"}'
  ].join('\n');
}

function buildUserPrompt(req: GlossRequest): string {
  const parts: string[] = [];
  if (req.bookTitle) parts.push(`书名：${req.bookTitle}`);
  parts.push(`要解释的词：${req.word}`);
  if (req.sentence) parts.push(`所在句子：${req.sentence}`);
  if (req.dictionarySenses?.length) {
    parts.push('词典义项：');
    // Cap both count and length — dictionary entries can be enormous, and a
    // 1.5B model's context is the binding constraint on this feature.
    for (const sense of req.dictionarySenses.slice(0, 6)) {
      parts.push(`- ${sense.slice(0, 200)}`);
    }
  }
  return parts.join('\n');
}

function stripFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/**
 * Parse the model's answer. Small models drift from the JSON contract often
 * enough that a plain-text reply has to be accepted rather than thrown away —
 * a usable sentence beats an error message.
 */
export function parseGloss(raw: string): GlossResult | undefined {
  const text = stripFence(raw);
  if (!text) return undefined;

  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { meaning?: unknown; note?: unknown };
      const meaning = typeof parsed.meaning === 'string' ? parsed.meaning.trim() : '';
      if (meaning) {
        const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';
        return note ? { meaning, note } : { meaning };
      }
    } catch {
      // Fall through to the plain-text path below.
    }
  }

  // Not JSON — take it as prose, trimmed to something a popover can hold.
  return { meaning: text.slice(0, 300) };
}

export async function requestGloss(
  opts: AiClientOpts,
  req: GlossRequest
): Promise<GlossResult | undefined> {
  const raw = await chatOnce(opts, {
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(req) }],
    maxTokens: 300,
    jsonMode: true,
    signal: req.signal
  });
  return parseGloss(raw);
}
