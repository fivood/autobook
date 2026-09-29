/**
 * The library's random-quote card and the Kindle import filter.
 *
 * The range test is the one that matters: the card exists to make an unread
 * book look worth opening, and a paragraph picked past the opening stretch
 * can be a mystery's reveal.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isQuotable,
  kindleRelPath,
  pendingKindleBooks,
  pickQuote,
  titleFromKindleFilename
} from '../src/lib/functions/random-quote.ts';

const para = (n: number) => '他走进房间，看见桌上放着一封没有署名的信，信封的边角已经被雨水打湿了，字迹却还清晰。'.repeat(n);

test('only picks from the 2%–15% stretch', () => {
  const blocks = [
    { text: para(1), pos: 0 }, // front matter
    { text: para(1), pos: 50 }, // in range
    { text: para(1), pos: 900 } // the ending
  ];
  for (const r of [0, 0.5, 0.999]) {
    assert.equal(pickQuote(blocks, 1000, () => r)?.pos, 50);
  }
  assert.equal(pickQuote([{ text: para(1), pos: 900 }], 1000), undefined);
});

test('isQuotable wants a sentence of reasonable length, not a heading', () => {
  assert.ok(isQuotable(para(1)));
  assert.ok(!isQuotable('太短了。'));
  assert.ok(!isQuotable(para(5)), 'too long');
  assert.ok(!isQuotable(para(1).slice(0, -1) + '，'), 'mid-sentence');
  assert.ok(!isQuotable('第十二章 ' + para(1)));
});

test('titleFromKindleFilename strips extension and trailing author groups', () => {
  assert.equal(titleFromKindleFilename('局外人 (加缪).azw3'), '局外人');
  assert.equal(titleFromKindleFilename('奥斯曼帝国：1299-1923).azw3'), '奥斯曼帝国：1299-1923)');
  assert.equal(titleFromKindleFilename('欧洲之心 (【英】彼得·威尔逊)（全2册）.azw3'), '欧洲之心');
  assert.equal(titleFromKindleFilename('(加缪).azw3'), '(加缪).azw3');
});

test('pendingKindleBooks skips already-imported paths and titles', () => {
  const root = 'H:\\';
  const paths = [
    'H:\\documents\\Downloads\\Items01\\局外人 (加缪).azw3',
    'H:\\documents\\Downloads\\Items01\\达·芬奇传：自由的心灵.azw3',
    'H:\\documents\\新书.epub'
  ];
  assert.equal(kindleRelPath(paths[2], root), 'documents/新书.epub');
  assert.equal(kindleRelPath('h:/documents/x.azw3', 'H:\\'), 'documents/x.azw3');
  const pending = pendingKindleBooks(
    paths,
    root,
    new Set(['documents/新书.epub']),
    new Set(['局外人'])
  );
  assert.deepEqual(pending, [paths[1]]);
});
