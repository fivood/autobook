import test from 'node:test';
import assert from 'node:assert/strict';
import { staleSiblings } from '../src/lib/data/storage/stale-siblings.ts';

/**
 * A book folder holds one file per prefix. When a write leaves two behind —
 * because the removal of the old one failed — every reader picks whichever
 * the directory lists first, and for `bookdata_` that is not the newest.
 */

const dir = 'AutoBook/Some Title';
const f = (name: string) => ({ name, path: `${dir}/${name}` });

test('the file being written is never swept', () => {
  const filename = 'progress_1_15_1800000000000_42.json';
  const files = [f(filename)];
  assert.deepEqual(staleSiblings(files, filename, `${dir}/${filename}`), []);
});

test('an older sibling with the same prefix is swept', () => {
  const filename = 'progress_1_15_1800000000000_42.json';
  const files = [f('progress_1_15_1700000000000_10.json'), f(filename)];
  const stale = staleSiblings(files, filename, `${dir}/${filename}`);
  assert.deepEqual(
    stale.map((e) => e.name),
    ['progress_1_15_1700000000000_10.json']
  );
});

test('every leftover duplicate goes, not just the one we read', () => {
  const filename = 'bookdata_1_15_120000_1800000000000_1800000000000.zip';
  const files = [
    f('bookdata_1_15_100000_1600000000000_1600000000000.zip'),
    f('bookdata_1_15_110000_1700000000000_1700000000000.zip'),
    f(filename)
  ];
  assert.equal(staleSiblings(files, filename, `${dir}/${filename}`).length, 2);
});

test('other prefixes in the same folder are left alone', () => {
  const filename = 'progress_1_15_1800000000000_42.json';
  const files = [
    f('bookdata_1_15_100000_1700000000000_1700000000000.zip'),
    f('cover_abc.jpg'),
    f('highlights_1_15_1700000000000_3.json'),
    f(filename)
  ];
  assert.deepEqual(staleSiblings(files, filename, `${dir}/${filename}`), []);
});

test('directory order does not decide which bookdata file wins', () => {
  // The regression in one line: alphabetically the OLD file comes first,
  // because 100000 < 90000 as text. `find` would have returned it.
  const older = 'bookdata_1_15_100000_1700000000000_1700000000000.zip';
  const newer = 'bookdata_1_15_90000_1800000000000_1800000000000.zip';
  const sorted = [older, newer].sort();
  assert.equal(sorted[0], older, 'precondition: the stale file sorts first');

  const stale = staleSiblings([f(older), f(newer)], newer, `${dir}/${newer}`);
  assert.deepEqual(
    stale.map((e) => e.name),
    [older]
  );
});
