/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Shared helpers used by every AutoReader engine.
 */

import type { AutoReader } from './types';

/**
 * One TTS unit. `text` is trimmed (engines choke on whitespace-only input),
 * but `start` / `end` are offsets into the ORIGINAL extractText() string.
 *
 * Carrying explicit offsets is load-bearing: the old code derived a global
 * index by summing `sentences[i].length`, which silently drifted by one
 * character for every whitespace byte trim() had removed. Over a novel with
 * a newline between every paragraph that adds up to hundreds of characters,
 * and the drift lands straight in the TTS sentence highlight and the
 * typewriter reveal — both of which index into the untrimmed string.
 */
export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * Cap on a single TTS unit. Only bites on pathological input (a wall of text
 * with no terminal punctuation); normal prose splits well below it. Without a
 * cap those become one multi-thousand-character utterance, which engines
 * reject with `text-too-long` — and the recovery path skips the whole thing,
 * silently dropping content from the read-through.
 */
const MAX_SENTENCE_LENGTH = 180;

const TERMINALS = new Set(['。', '！', '？', '；', '…', '.', '!', '?', ';', '\n']);

/** Closing marks that belong to the sentence they follow, not the next one.
 *  Chinese fiction is full of 「…。」 and “…！” — splitting on the terminal
 *  alone strands the closer at the head of the next utterance. */
const CLOSERS = new Set([
  '」', '』', '”', '’', '"', "'",
  '）', ')', '》', '〉', '】', '］', ']', '｝', '}', '〕', '〗'
]);

/** Preferred break points when a unit has to be cut for length. */
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', '—', '–', ' ', '　']);

/** Lowercased words whose trailing period is part of the abbreviation. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'inc', 'ltd',
  'co', 'no', 'vol', 'fig', 'ch', 'p', 'pp', 'ed', 'eds', 'cf', 'al', 'approx',
  'dept', 'est', 'min', 'max', 'ave', 'blvd', 'rd'
]);

/** Is the '.' at `i` an actual sentence terminator, or part of a token? */
function isSentencePeriod(text: string, i: number): boolean {
  const prev = text[i - 1];
  const next = text[i + 1];

  // Decimals and dotted version/IP numbers: 3.14, v1.2.3, 192.168.0.1
  if (prev >= '0' && prev <= '9' && next >= '0' && next <= '9') return false;

  // Scan back over the alphabetic token immediately before the dot.
  let j = i - 1;
  while (j >= 0 && /[A-Za-z]/.test(text[j])) j -= 1;
  const word = text.slice(j + 1, i);

  // A lone letter before a period is an initial or a dotted abbreviation
  // ("J. K. Rowling", "e.g.", "a.m.", "U.S.A."), never a sentence end —
  // single-letter sentences don't occur in prose.
  if (word.length === 1) return false;
  if (ABBREVIATIONS.has(word.toLowerCase())) return false;

  return true;
}

/** Trim `text[from, to)` and emit it, splitting further if over the cap. */
function emit(out: Sentence[], text: string, from: number, to: number, maxLength: number) {
  const raw = text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (!trimmed) return;

  const base = from + lead;

  if (trimmed.length <= maxLength) {
    out.push({ text: trimmed, start: base, end: base + trimmed.length });
    return;
  }

  // Over the cap: walk forward cutting at the last soft break inside each
  // window, so the pieces still land on comma/colon boundaries and the voice
  // doesn't chop mid-word. Falls back to a hard cut when a window has none.
  let cursor = 0;
  while (trimmed.length - cursor > maxLength) {
    const windowEnd = cursor + maxLength;
    let cut = -1;
    for (let k = windowEnd; k > cursor + maxLength / 2; k -= 1) {
      if (SOFT_BREAKS.has(trimmed[k])) {
        cut = k + 1;
        break;
      }
    }
    if (cut < 0) cut = windowEnd;
    const piece = trimmed.slice(cursor, cut).trim();
    if (piece) {
      const pieceLead = trimmed.slice(cursor, cut).length - trimmed.slice(cursor, cut).trimStart().length;
      out.push({
        text: piece,
        start: base + cursor + pieceLead,
        end: base + cursor + pieceLead + piece.length
      });
    }
    cursor = cut;
  }
  const tailRaw = trimmed.slice(cursor);
  const tail = tailRaw.trim();
  if (tail) {
    const tailLead = tailRaw.length - tailRaw.trimStart().length;
    out.push({
      text: tail,
      start: base + cursor + tailLead,
      end: base + cursor + tailLead + tail.length
    });
  }
}

/**
 * Split into TTS units, each carrying its offset into `text`.
 *
 * A unit ends at a run of terminal punctuation plus any closing quotes /
 * brackets that trail it. Periods that belong to a number or an abbreviation
 * don't terminate. Units longer than `maxLength` are cut at soft breaks.
 */
export function splitSentencesDetailed(
  text: string,
  maxLength = MAX_SENTENCE_LENGTH
): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let i = 0;

  const isTerminalAt = (idx: number) => {
    const ch = text[idx];
    if (!TERMINALS.has(ch)) return false;
    if (ch === '.' && !isSentencePeriod(text, idx)) return false;
    return true;
  };

  while (i < text.length) {
    if (!isTerminalAt(i)) {
      i += 1;
      continue;
    }
    // Absorb the run of terminals, then any closers, then any terminals that
    // follow those (「真的吗？」。) — until neither applies.
    let end = i + 1;
    for (;;) {
      if (end < text.length && isTerminalAt(end)) {
        end += 1;
        continue;
      }
      if (end < text.length && CLOSERS.has(text[end])) {
        end += 1;
        continue;
      }
      break;
    }
    emit(out, text, start, end, maxLength);
    start = end;
    i = end;
  }

  if (start < text.length) emit(out, text, start, text.length, maxLength);

  return out;
}

/**
 * Flatten the rendered book content to plain text.
 *
 * Always a straight text-node walk — deliberately NOT special-cased on the
 * typewriter's `.tw-c` spans. Wrapping each character in a span doesn't change
 * what a SHOW_TEXT walk yields, so the special case bought nothing, and it
 * actively dropped the raw \n / \t nodes that prepareChars() leaves unwrapped:
 * the same book returned a different string (and therefore different char
 * indices) depending on whether the typewriter had run yet.
 */
export function extractText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const parts: string[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE') {
        parts.push(node.textContent || '');
      }
    }
    node = walker.nextNode();
  }
  return parts.join('');
}

export function computeGlobalCharIndex(
  sentences: Sentence[],
  index: number,
  localOffset: number
): number {
  const sentence = sentences[index];
  if (!sentence) return 0;
  return sentence.start + localOffset;
}

/**
 * Translate a DOM (node, offset) pair inside the rendered book content into
 * a character index that aligns with extractText() output — so it can feed
 * straight into seekSentencesToExplored / autoReader.seekToExplored.
 */
function domPositionToCharIndex(
  root: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag !== 'SCRIPT' && tag !== 'STYLE') {
        if (node === targetNode) {
          return total + targetOffset;
        }
        total += (node.textContent || '').length;
      }
    }
    node = walker.nextNode();
  }
  // Selection anchored on an element (rather than a text node) — resolve it
  // to the first text node inside and retry once.
  if (targetNode.nodeType === Node.ELEMENT_NODE) {
    const inner = document.createTreeWalker(targetNode, NodeFilter.SHOW_TEXT, null).nextNode();
    if (inner) return domPositionToCharIndex(root, inner, 0);
  }
  return null;
}

/**
 * Where the last selection inside the tracked content started, as a char
 * index into `extractText(trackedRoot)`.
 *
 * Stored as a number rather than as the Range, and that is the whole point:
 * it is what lets "select a passage, highlight it, press play" start at the
 * passage. Applying a highlight calls removeAllRanges() — the selection
 * overlay would otherwise sit on top of the fresh mark — so there is no live
 * selection left by the time the user reaches the play button. Holding the
 * Range would not survive either: the highlight renderer unwraps every
 * <mark>, normalize()s the container and re-wraps, merging and splitting
 * exactly the text nodes a stale Range points at. A char index is untouched
 * by all of that, since <mark> contributes no text.
 */
let rememberedIndex: number | null = null;

/**
 * Element the remembered index is measured against — the reader's own
 * contentEl. /b's outer .book-content wrapper walks text nodes in a different
 * order, so an index taken there lands somewhere else entirely.
 */
let trackedRoot: HTMLElement | undefined;

let listeningForSelection = false;

function rememberSelection() {
  if (!trackedRoot) return;
  const sel = window.getSelection();
  // rangeCount 0 means the selection was wiped rather than moved — the very
  // case this memory exists for, so keep what we already have.
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!trackedRoot.contains(range.startContainer)) return;
  rememberedIndex = domPositionToCharIndex(trackedRoot, range.startContainer, range.startOffset);
}

/** Point the selection memory at this reader's content. Called from
 *  setContentEl, so it resets on every section / view-mode change. */
export function trackSelectionIn(root: HTMLElement | undefined) {
  trackedRoot = root;
  rememberedIndex = null;
  if (root && typeof document !== 'undefined' && !listeningForSelection) {
    listeningForSelection = true;
    document.addEventListener('selectionchange', rememberSelection);
  }
}

/**
 * Convenience: read the current document selection's start position and map
 * it to a char index inside `root`. Falls back to the last selection the
 * tracker saw — once — when nothing is selected any more.
 */
export function selectionToCharIndex(root: HTMLElement): number | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (root.contains(range.startContainer)) {
      return domPositionToCharIndex(root, range.startContainer, range.startOffset);
    }
  }
  if (root !== trackedRoot) return null;
  // Consumed on read: a selection made and forgotten ten pages ago must not
  // hijack the *next* play, which falls back to the resume position as before.
  const index = rememberedIndex;
  rememberedIndex = null;
  return index;
}

/**
 * Put the reader where `strategy` says playback should begin. `prepare()`
 * must already have run — every branch needs the sentence list.
 *
 * Shared because two places start playback: the FAB and the tray / global
 * shortcut handler in /b. The latter used to jump straight to the resume
 * position, so the start strategy silently did not apply to it.
 */
export function applyStartPosition(
  reader: Pick<AutoReader, 'seekToSelection' | 'setPosition' | 'seekToExplored'>,
  strategy: string,
  resumePosition: { para: number; offset: number } | undefined,
  seekCharCount: number
) {
  if (strategy === 'selection' && reader.seekToSelection()) return;
  if (strategy === 'section-start') reader.setPosition(0, 0);
  else if (resumePosition) reader.setPosition(resumePosition.para, resumePosition.offset);
  else reader.seekToExplored(seekCharCount);
}

/**
 * The paginated calculator counts characters via getCharacterCount(), which
 * strips whitespace, punctuation and most non-CJK symbols. TTS engines report
 * boundary positions as offsets into the raw extractText() string. Convert
 * one into the other so we can hand a TTS boundary char-index to
 * SectionCharacterStatsCalculator.getScrollPosByCharCount().
 */
const NOT_COUNTED_REGEX =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

export function ttsIndexToCalculatorIndex(extractedText: string, ttsIndex: number): number {
  const slice = extractedText.slice(0, ttsIndex);
  return Array.from(slice.replace(NOT_COUNTED_REGEX, '')).length;
}

/**
 * Locate the sentence covering a global char offset. Offsets that land in the
 * whitespace between two sentences resolve to the start of the following one,
 * so resuming never replays text the user already heard.
 */
export function seekSentencesToExplored(
  sentences: Sentence[],
  exploredCharCount: number
): { index: number; offset: number } {
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    if (exploredCharCount < s.start) return { index: i, offset: 0 };
    if (exploredCharCount < s.end) return { index: i, offset: exploredCharCount - s.start };
  }
  return { index: sentences.length, offset: 0 };
}
