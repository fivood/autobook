/**
 * Where TTS starts when the user presses play.
 *
 * Two things are guarded here, both of them the "选择一段文字高亮再点朗读"
 * report: playback started at the resume position instead of at the passage
 * the user had just selected.
 *
 * 1. The selection memory. Applying a highlight calls removeAllRanges(), so
 *    the live selection is already gone by the time the play button is hit —
 *    `selectionToCharIndex` has to fall back to the last position the tracker
 *    saw, and must consume it so a long-stale selection can't hijack the next
 *    play.
 * 2. `applyStartPosition`, which both play paths (FAB + tray / global
 *    shortcut) now share. The shortcut path used to ignore the strategy.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStartPosition,
  selectionToCharIndex,
  trackSelectionIn
} from '../src/lib/components/book-reader/auto-reader-shared.ts';

// --- minimal DOM ------------------------------------------------------------
// The module reaches for exactly three things: document.createTreeWalker,
// document.addEventListener('selectionchange') and window.getSelection.

const nodes = [
  { nodeType: 3, textContent: 'こんにちは', parentElement: { tagName: 'P' } },
  { nodeType: 3, textContent: '世界です', parentElement: { tagName: 'P' } }
];

let onSelectionChange: (() => void) | undefined;
let selection: { rangeCount: number; getRangeAt?: () => unknown } = { rangeCount: 0 };

const root = { contains: (n: unknown) => nodes.includes(n as never) } as unknown as HTMLElement;
const otherRoot = { contains: () => true } as unknown as HTMLElement;

(globalThis as any).NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
(globalThis as any).document = {
  createTreeWalker() {
    let i = -1;
    return { nextNode: () => (i < nodes.length - 1 ? nodes[++i] : null) };
  },
  addEventListener(type: string, fn: () => void) {
    if (type === 'selectionchange') onSelectionChange = fn;
  }
};
(globalThis as any).window = { getSelection: () => selection };

/** Selection starting `offset` chars into node `n`, as the browser reports it. */
function selectAt(n: number, offset: number) {
  selection = {
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: nodes[n], startOffset: offset })
  };
  onSelectionChange?.();
}

/** What removeAllRanges() leaves behind — the state after highlighting. */
function wipeSelection() {
  selection = { rangeCount: 0 };
  onSelectionChange?.();
}

// --- selection memory -------------------------------------------------------

test('a live selection maps straight to its char index', () => {
  trackSelectionIn(root);
  selectAt(1, 2);
  // 5 chars of node 0, then 2 into node 1.
  assert.equal(selectionToCharIndex(root), 7);
});

test('highlighting clears the selection, the index survives — once', () => {
  trackSelectionIn(root);
  selectAt(1, 2);
  wipeSelection();

  assert.equal(selectionToCharIndex(root), 7, 'the passage the user highlighted');
  assert.equal(selectionToCharIndex(root), null, 'consumed: next play resumes as before');
});

test('the memory belongs to the tracked content only', () => {
  trackSelectionIn(root);
  selectAt(0, 3);
  wipeSelection();
  assert.equal(selectionToCharIndex(otherRoot), null);
});

test('a new section drops the memory', () => {
  trackSelectionIn(root);
  selectAt(0, 3);
  wipeSelection();
  trackSelectionIn(root);
  assert.equal(selectionToCharIndex(root), null);
});

// --- start strategy ---------------------------------------------------------

function fakeReader(seekWorks: boolean) {
  const calls: string[] = [];
  return {
    calls,
    seekToSelection: () => {
      calls.push('selection');
      return seekWorks;
    },
    setPosition: (para: number, offset: number) => calls.push(`position:${para},${offset}`),
    seekToExplored: (count: number) => calls.push(`explored:${count}`)
  };
}

const resume = { para: 4, offset: 6 };

test('selection wins when there is one', () => {
  const reader = fakeReader(true);
  applyStartPosition(reader, 'selection', resume, 99);
  assert.deepEqual(reader.calls, ['selection']);
});

test('selection falls back to the resume position', () => {
  const reader = fakeReader(false);
  applyStartPosition(reader, 'selection', resume, 99);
  assert.deepEqual(reader.calls, ['selection', 'position:4,6']);
});

test('no resume position yet: seek to how far the book was explored', () => {
  const reader = fakeReader(false);
  applyStartPosition(reader, 'selection', undefined, 99);
  assert.deepEqual(reader.calls, ['selection', 'explored:99']);
});

test('the other strategies never touch the selection', () => {
  const sectionStart = fakeReader(true);
  applyStartPosition(sectionStart, 'section-start', resume, 99);
  assert.deepEqual(sectionStart.calls, ['position:0,0']);

  const resumeOnly = fakeReader(true);
  applyStartPosition(resumeOnly, 'resume', resume, 99);
  assert.deepEqual(resumeOnly.calls, ['position:4,6']);
});
