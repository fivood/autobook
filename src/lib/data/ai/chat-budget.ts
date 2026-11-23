/**
 * Size limits for the reader assistant's requests.
 *
 * Each question carries the system prompt, ~6 retrieved book chunks (≥800
 * chars each, bm25-index TARGET_CHUNK_CHARS) plus ~2000 chars of "just read"
 * tail, and the chat so far. The first two are rebuilt per question and are
 * bounded; the history was not, so a long chat grew every request until the
 * endpoint refused it — or, on Ollama, silently lost the start of the prompt.
 */

/** Older turns past this many characters are left out, oldest first. */
export const HISTORY_CHAR_BUDGET = 6000;
/** …and never more than this many messages (3 user + 3 assistant + current). */
export const HISTORY_MAX_MESSAGES = 7;

/**
 * The most recent messages that fit the budget, oldest dropped first. The last
 * message (the question being asked) is always kept, however long, and the
 * result never starts on an assistant turn — a reply without its question is
 * noise, and Anthropic rejects a conversation that opens with one.
 */
export function trimHistory<T extends { role: string; content: string }>(
  messages: readonly T[],
  charBudget = HISTORY_CHAR_BUDGET,
  maxMessages = HISTORY_MAX_MESSAGES
): T[] {
  const kept: T[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (kept.length && (kept.length >= maxMessages || used + m.content.length > charBudget)) break;
    kept.unshift(m);
    used += m.content.length;
  }
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  return kept;
}

/**
 * Rough token count. CJK runs about one token per character on the tokenizers
 * local models use (Qwen, Llama 3), Latin text about one per four. Erring
 * high is the safe direction: it only sizes a context window.
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯豈-﫿]/g)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 3.5);
}

/** Ollama `num_ctx` for a prompt of `promptTokens` plus a `replyTokens` answer. */
export function ollamaContextFor(promptTokens: number, replyTokens: number): number {
  const need = Math.ceil(((promptTokens + replyTokens) * 1.1) / 2048) * 2048;
  return Math.min(32768, Math.max(8192, need));
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
}
