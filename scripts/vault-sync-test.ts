/**
 * Vault sync planner: the matching rules, without a filesystem.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { planVaultSync, categoryOfPath, type SyncedBook } from '../src/lib/functions/vault-sync.ts';

const book = (id: number, sourcePath: string, sourceText?: string): SyncedBook => ({
  id,
  sourcePath,
  sourceText
});

test('untouched files produce no work', () => {
  const plan = planVaultSync(
    [{ path: '读书/a.md', content: 'hello' }],
    [book(1, '读书/a.md', 'hello')]
  );
  assert.deepEqual(
    [plan.changed.length, plan.moved.length, plan.added.length, plan.removed.length],
    [0, 0, 0, 0]
  );
});

test('edited file is re-rendered, not re-imported', () => {
  const plan = planVaultSync(
    [{ path: '读书/a.md', content: 'new text' }],
    [book(1, '读书/a.md', 'old text')]
  );
  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0].book.id, 1);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.removed.length, 0);
});

test('moved file keeps the book: same content, new path', () => {
  const plan = planVaultSync(
    [{ path: '工作/a.md', content: 'same' }],
    [book(1, '读书/a.md', 'same')]
  );
  assert.deepEqual(plan.moved, [{ book: book(1, '读书/a.md', 'same'), path: '工作/a.md' }]);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.removed.length, 0, 'a move must not look like a deletion');
});

test('rename is a move too — the filename is not the identity', () => {
  const plan = planVaultSync(
    [{ path: '读书/新名字.md', content: 'same' }],
    [book(1, '读书/旧名字.md', 'same')]
  );
  assert.equal(plan.moved.length, 1);
  assert.equal(plan.removed.length, 0);
});

test('rename + edit together degrades to remove + add', () => {
  const plan = planVaultSync(
    [{ path: '读书/新名字.md', content: 'edited' }],
    [book(1, '读书/旧名字.md', 'original')]
  );
  assert.equal(plan.moved.length, 0);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.removed.length, 1, 'caller must guard this with the progress check');
});

test('same filename in two folders stays two books', () => {
  // The whole reason identity is the path: both of these are titled index.md.
  const plan = planVaultSync(
    [
      { path: 'a/index.md', content: 'A' },
      { path: 'b/index.md', content: 'B' }
    ],
    [book(1, 'a/index.md', 'A'), book(2, 'b/index.md', 'B')]
  );
  assert.deepEqual(
    [plan.changed.length, plan.moved.length, plan.added.length, plan.removed.length],
    [0, 0, 0, 0]
  );
});

test('new file is added, vanished file is removed', () => {
  const plan = planVaultSync(
    [{ path: '读书/new.md', content: 'fresh' }],
    [book(1, '读书/gone.md', 'stale')]
  );
  assert.deepEqual(plan.added, [{ path: '读书/new.md', content: 'fresh' }]);
  assert.equal(plan.removed.length, 1);
  assert.equal(plan.removed[0].id, 1);
});

test('two identical-content files cannot both claim one orphan', () => {
  const plan = planVaultSync(
    [
      { path: 'x/dup.md', content: 'twin' },
      { path: 'y/dup.md', content: 'twin' }
    ],
    [book(1, 'z/dup.md', 'twin')]
  );
  assert.equal(plan.moved.length, 1, 'exactly one match');
  assert.equal(plan.added.length, 1, 'the other becomes a new book');
  assert.equal(plan.removed.length, 0);
});

test('a book with no recorded content never matches by content', () => {
  // Otherwise `undefined === undefined` would let an unread book absorb any
  // new empty file.
  const plan = planVaultSync([{ path: 'a.md', content: '' }], [book(1, 'gone.md', undefined)]);
  assert.equal(plan.moved.length, 0);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.removed.length, 1);
});

test('category comes from the folders above the file', () => {
  assert.equal(categoryOfPath('读书/技术/某书.md'), '读书/技术');
  assert.equal(categoryOfPath('读书/某书.md'), '读书');
  assert.equal(categoryOfPath('根目录.md'), '', 'files at the root are uncategorized');
});
