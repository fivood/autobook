import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBook } from '../src/lib/functions/book-search.ts';

// Stand-in for the reader's counted-character rule: letters and digits only.
const isCounted = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

const blocks = [
  { text: '第一章 雨', pos: 0 },
  { text: '他说：“明天，再见。”然后走了。', pos: 4 },
  { text: 'Hello, World! hello again.', pos: 14 }
];

test('punctuation and spacing typed from paper do not matter', () => {
  const [hit] = searchBook(blocks, '明天 再见', isCounted);
  // 他说 are counted characters 0-1 of the block, 明 is 2.
  assert.equal(hit.pos, 4 + 2);
  assert.equal(hit.match, '明天，再见');
  assert.equal(hit.before, '他说：“');
});

test('case-insensitive, every occurrence, in order', () => {
  const hits = searchBook(blocks, 'HELLO', isCounted);
  assert.deepEqual(
    hits.map((h) => [h.pos, h.match]),
    [
      [14, 'Hello'],
      [14 + 10, 'hello']
    ]
  );
});

test('a query with nothing countable finds nothing', () => {
  assert.deepEqual(searchBook(blocks, '，。 ', isCounted), []);
});

test('characters outside the BMP count as one position each', () => {
  const [hit] = searchBook([{ text: '𠮷野家で食べる', pos: 100 }], '食べる', isCounted);
  // 𠮷 野 家 で → 食 is the fifth code point; 𠮷 is two UTF-16 units.
  assert.equal(hit.pos, 100 + 4);
});

test('limit caps the result list', () => {
  const many = [{ text: 'aaaa', pos: 0 }];
  assert.equal(searchBook(many, 'a', isCounted, 2).length, 2);
});

test('long blocks get ellipses around the context window', () => {
  const text = 'x'.repeat(50) + '目标' + 'y'.repeat(50);
  const [hit] = searchBook([{ text, pos: 0 }], '目标', isCounted);
  assert.ok(hit.before.startsWith('…') && hit.after.endsWith('…'));
  assert.equal(hit.pos, 50);
});
