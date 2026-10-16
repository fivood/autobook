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
  rememberPlaybackHandoff,
  seekSentencesToExplored,
  isNoteMarker,
  selectionToCharIndex,
  splitSentencesDetailed,
  takePlaybackHandoff,
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
    seekToExplored: (count: number, snap?: boolean) =>
      calls.push(`explored:${count}${snap ? ':snap' : ''}`)
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

// --- playback handover ------------------------------------------------------
//
// The typewriter and the voice are mutually exclusive, so pausing one is
// nearly always a prelude to starting the other. The frontier travels as a DOM
// position (the two engines count characters differently) and is turned into
// an index here, against the same content the selection memory tracks.

test('a paused typewriter hands its frontier to the next play', () => {
  trackSelectionIn(root);
  rememberPlaybackHandoff(nodes[1], 2); // 5 chars of node 0, then 2 into node 1
  const reader = fakeReader(false);
  applyStartPosition(reader, 'selection', resume, 99);
  assert.deepEqual(
    reader.calls,
    ['selection', 'explored:7:snap'],
    'beats the saved resume position, and rewinds to the sentence start'
  );
});

test('the handover is consumed, like the selection memory', () => {
  trackSelectionIn(root);
  rememberPlaybackHandoff(nodes[1], 2);
  applyStartPosition(fakeReader(false), 'selection', resume, 99);

  const second = fakeReader(false);
  applyStartPosition(second, 'selection', resume, 99);
  assert.deepEqual(second.calls, ['selection', 'position:4,6'], 'back to the normal order');
});

test('an explicit start point still wins over a handover', () => {
  trackSelectionIn(root);
  rememberPlaybackHandoff(nodes[1], 2);
  const selected = fakeReader(true);
  applyStartPosition(selected, 'selection', resume, 99);
  assert.deepEqual(selected.calls, ['selection'], 'the passage the reader picked');

  trackSelectionIn(root);
  rememberPlaybackHandoff(nodes[1], 2);
  const sectionStart = fakeReader(false);
  applyStartPosition(sectionStart, 'section-start', resume, 99);
  assert.deepEqual(sectionStart.calls, ['position:0,0'], 'the strategy the reader chose');
});

test('a new section drops the handover', () => {
  trackSelectionIn(root);
  rememberPlaybackHandoff(nodes[1], 2);
  trackSelectionIn(root);
  assert.equal(takePlaybackHandoff(), null);
});

test('a handover from outside the tracked content is ignored', () => {
  trackSelectionIn(undefined);
  rememberPlaybackHandoff(nodes[1], 2);
  assert.equal(takePlaybackHandoff(), null);
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
