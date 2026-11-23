import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeNoteMarker } from '../src/lib/components/book-reader/footnote.ts';

test('note markers seen in real books', () => {
  for (const t of ['1', '12', '[3]', '(4)', '（5）', '【6】', '［注2］', '注', '★', '[☆]', '*', '※', '†', ' [ 7 ] ', 'iv']) {
    assert.ok(looksLikeNoteMarker(t), t);
  }
});

test('ordinary link text keeps jumping', () => {
  for (const t of ['', '第一章', 'Chapter 1', '1234', '见第三章', '返回', 'Back to top']) {
    assert.ok(!looksLikeNoteMarker(t), t);
  }
});
