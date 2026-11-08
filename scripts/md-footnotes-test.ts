import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMdFootnotes } from '../src/lib/functions/file-loaders/md/md-footnotes.ts';

test('refs numbered by first use, definitions lifted out', () => {
  const { text, notes } = extractMdFootnotes(
    ['A[^b] then B[^a] and A again[^b].', '', '[^a]: note a', '[^b]: note b', '    continued'].join('\n')
  );
  assert.deepEqual(notes, [
    { n: 1, text: 'note b continued' },
    { n: 2, text: 'note a' }
  ]);
  assert.ok(!text.includes('[^'));
  assert.ok(!text.includes('note a'));
  // first reference carries the back-link target, the repeat doesn't
  assert.equal(text.match(/id="md-fnref-1"/g)?.length, 1);
  assert.equal(text.match(/href="#md-fn-1"/g)?.length, 2);
});

test('code is left alone, undefined refs stay literal', () => {
  const src = ['`[^1]` and [^zz]', '```', '[^1]: in code', 'x[^1]', '```', 'y[^1]', '[^1]: real'].join('\n');
  const { text, notes } = extractMdFootnotes(src);
  assert.deepEqual(notes, [{ n: 1, text: 'real' }]);
  assert.ok(text.includes('`[^1]` and [^zz]'));
  assert.ok(text.includes('[^1]: in code\nx[^1]'));
  assert.ok(text.includes('y<sup'));
});

test('no footnotes, source untouched', () => {
  const src = 'plain [link](#x) text\r\nline 2';
  assert.equal(extractMdFootnotes(src).text, src);
});
