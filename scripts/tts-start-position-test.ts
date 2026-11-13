/**
 * Where playback starts when the user presses play — the voice and the
 * typewriter share one rule (`resolvePlaybackStart`).
 *
 * 1. The selection memory. Applying a highlight calls removeAllRanges(), so
 *    the live selection is already gone by the time the play button is hit —
 *    the start has to come from the last position the tracker saw. It is
 *    consumed, and a live selection or caret is dropped with it, so a caret
 *    left in place doesn't pull every later play back to it.
 * 2. The order: a selection or caret, then where playback stopped while it is
 *    still on screen, then the screen itself — which the voice reaches in the
 *    position calculator's space, not extractText's (that mix-up started the
 *    voice paragraphs before the screen).
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStartPosition,
  indexOfPosition,
  seekSentencesToExplored,
  isNoteMarker,
  selectionToCharIndex,
  splitSentencesDetailed,
  trackSelectionIn
} from '../src/lib/components/book-reader/auto-reader-shared.ts';

// --- minimal DOM ------------------------------------------------------------
// The module reaches for exactly three things: document.createTreeWalker,
// document.addEventListener('selectionchange') and window.getSelection.

const nodes = [
  { nodeType: 3, textContent: 'こんにちは', parentElement: { tagName: 'P' } },
  { nodeType: 3, textContent: '世界です', parentElement: { tagName: 'P' } }
];

type FakeSelection = {
  rangeCount: number;
  getRangeAt?: () => unknown;
  removeAllRanges?: () => void;
};

let onSelectionChange: (() => void) | undefined;
let selection: FakeSelection = { rangeCount: 0 };

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

/** Selection (or caret) starting `offset` chars into node `n`. */
function selectAt(n: number, offset: number) {
  selection = {
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: nodes[n], startOffset: offset }),
    removeAllRanges: () => {
      selection = { rangeCount: 0 };
    }
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
  assert.equal(selectionToCharIndex(root), null, 'consumed');
});

test('a caret starts play once; pause → play resumes instead of jumping back', () => {
  trackSelectionIn(root);
  selectAt(1, 2);
  assert.equal(selectionToCharIndex(root), 7);
  assert.equal(selection.rangeCount, 0, 'the caret is dropped with it');
  assert.equal(selectionToCharIndex(root), null);
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

// --- start rule -------------------------------------------------------------

function fakeReader() {
  const calls: string[] = [];
  return {
    calls,
    seekToExplored: (count: number, snap?: boolean) =>
      calls.push(`explored:${count}${snap ? ':snap' : ''}`),
    seekToCalculatorIndex: (count: number) => calls.push(`calc:${count}`)
  };
}

const onScreen = () => true;
const offScreen = () => false;

test('a selection or caret wins, exactly where it is', () => {
  trackSelectionIn(root);
  selectAt(1, 2);
  const reader = fakeReader();
  applyStartPosition(reader, 'selection', 3, 99, onScreen);
  assert.deepEqual(reader.calls, ['explored:7']);
});

test('otherwise where playback stopped, snapped to its sentence, while on screen', () => {
  trackSelectionIn(root);
  const reader = fakeReader();
  applyStartPosition(reader, 'selection', 3, 99, onScreen);
  assert.deepEqual(reader.calls, ['explored:3:snap']);
});

test('a stop point the reader scrolled or jumped away from does not drag them back', () => {
  trackSelectionIn(root);
  const reader = fakeReader();
  applyStartPosition(reader, 'selection', 3, 99, offScreen);
  assert.deepEqual(reader.calls, ['calc:99']);
});

test('nothing at all: the screen, in the calculator space it was measured in', () => {
  trackSelectionIn(root);
  const reader = fakeReader();
  applyStartPosition(reader, 'selection', undefined, 99, onScreen);
  // Not an extractText index: feeding it to seekToExplored started the voice
  // paragraphs before the screen.
  assert.deepEqual(reader.calls, ['calc:99']);
});

test("'resume' goes back to the stop point even off screen — a selection still wins", () => {
  trackSelectionIn(root);
  const offScreenStop = fakeReader();
  applyStartPosition(offScreenStop, 'resume', 3, 99, offScreen);
  assert.deepEqual(offScreenStop.calls, ['explored:3:snap']);

  selectAt(1, 2);
  const picked = fakeReader();
  applyStartPosition(picked, 'resume', 3, 99, offScreen);
  assert.deepEqual(picked.calls, ['explored:7']);
});

test("a stored 'section-start' (option removed) reads as the default", () => {
  trackSelectionIn(root);
  const reader = fakeReader();
  applyStartPosition(reader, 'section-start', 3, 99, onScreen);
  assert.deepEqual(reader.calls, ['explored:3:snap']);
});

// --- playback cursor --------------------------------------------------------
//
// The typewriter's frontier joins the cursor as a DOM position (the two
// engines count characters differently) and becomes an index here, against
// the same content the selection memory tracks.

test("the typewriter's frontier becomes an index into the voice's text", () => {
  trackSelectionIn(root);
  assert.equal(indexOfPosition(nodes[1] as unknown as Node, 2), 7);
});

test('a position outside any tracked content has no index', () => {
  trackSelectionIn(undefined);
  assert.equal(indexOfPosition(nodes[1] as unknown as Node, 2), null);
});

// --- sentence snapping ------------------------------------------------------

const sentences = [
  { text: 'ABCDE', start: 0, end: 5 },
  { text: 'FGHIJ', start: 5, end: 10 }
];

test('snapping rewinds to the start of the sentence the index lands inside', () => {
  assert.deepEqual(seekSentencesToExplored(sentences, 8), { index: 1, offset: 3 });
  assert.deepEqual(seekSentencesToExplored(sentences, 8, true), { index: 1, offset: 0 });
});

test('snapping changes nothing when the index is already a sentence start', () => {
  assert.deepEqual(seekSentencesToExplored(sentences, 5, true), { index: 1, offset: 0 });
  assert.deepEqual(seekSentencesToExplored(sentences, 0, true), { index: 0, offset: 0 });
});

test('snapping past the end still reports the end', () => {
  assert.deepEqual(seekSentencesToExplored(sentences, 99, true), { index: 2, offset: 0 });
});

// --- sentence splitting -----------------------------------------------------

test('punctuation stranded by a note marker is not sent as a sentence', () => {
  // 《平面国》: 「…倾向。<sup>[3]</sup> ’”<sup>[4]</sup>」 as extractText
  // flattens it. The lone 「’”」 made Edge TTS return no audio and the whole
  // read-through stop with 「未收到任何音频」.
  const text = '‘人类的天性有一个共同的倾向。\n[3]\n\n ’”\n[4]\n\n我认为';
  const units = splitSentencesDetailed(text);
  assert.deepEqual(
    units.map((u) => u.text),
    ['‘人类的天性有一个共同的倾向。', '[3]', '[4]', '我认为']
  );
  for (const u of units) assert.equal(text.slice(u.start, u.end), u.text);
});

test('a unit is kept when it has any letter or digit, in any script', () => {
  const units = splitSentencesDetailed('……\n——！\n3。\nΩ.\n');
  assert.deepEqual(units.map((u) => u.text), ['3。', 'Ω.']);
});

// --- note markers are not read aloud -----------------------------------------

const el = (tagName: string, text: string, attrs: Record<string, string> = {}) =>
  ({ tagName, textContent: text, getAttribute: (k: string) => attrs[k] ?? null }) as unknown as Element;

test('footnote markers are recognised', () => {
  // 《平面国》's markup, after import rewrote the href to a bare fragment.
  assert.ok(isNoteMarker(el('A', '[3]', { href: '#footnote_3', 'epub:type': 'noteref' })));
  assert.ok(isNoteMarker(el('A', '12', { href: '#n12' })));
  assert.ok(isNoteMarker(el('A', '［注3］', { href: '#n3' })));
  assert.ok(isNoteMarker(el('A', '*', { href: '#fn' })));
  assert.ok(isNoteMarker(el('SUP', ' [4] ')));
  assert.ok(isNoteMarker(el('SUP', '注1')));
});

test('exponents, links and words are still read', () => {
  assert.ok(!isNoteMarker(el('SUP', '2'))); // 10², m²
  assert.ok(!isNoteMarker(el('A', '第三章', { href: '#ch3' })));
  assert.ok(!isNoteMarker(el('A', '3', { href: 'https://example.com/3' })));
  assert.ok(!isNoteMarker(el('A', '[3]'))); // not a link at all
  assert.ok(!isNoteMarker(el('SPAN', '[3]')));
});
