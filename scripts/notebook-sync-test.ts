/**
 * Orphan detection for the notebook → vault export.
 *
 * The filename embeds a slug of the highlight text, so editing a highlight
 * renames its file. This decides which leftovers to delete — and deleting the
 * wrong file means losing a note, so the boundaries matter more than the happy
 * path.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { staleVaultFiles, type VaultSyncFile } from '../src/lib/functions/notebook/obsidian-sync.ts';

const f = (id: number, relativePath: string): VaultSyncFile => ({
  id,
  relativePath,
  content: ''
});

test('renamed file is reported, current one is kept', () => {
  const planned = [f(7, '书名/7-new-slug.md')];
  const stale = staleVaultFiles(planned, ['7-new-slug.md', '7-old-slug.md'], '书名');
  assert.deepEqual(stale, ['7-old-slug.md']);
});

test('unchanged filename produces nothing to delete', () => {
  const planned = [f(7, '书名/7-same.md')];
  assert.deepEqual(staleVaultFiles(planned, ['7-same.md'], '书名'), []);
});

test('a note that no longer exists locally is left alone', () => {
  // Deleting these would mean mirroring deletions, which this export has never
  // done — a file for a highlight removed in AutoBook must survive.
  const planned = [f(7, '书名/7-a.md')];
  assert.deepEqual(staleVaultFiles(planned, ['7-a.md', '99-gone.md'], '书名'), []);
});

test('files without an id prefix are never touched', () => {
  // Anything the user dropped in the folder by hand.
  const planned = [f(7, '书名/7-a.md')];
  const stale = staleVaultFiles(planned, ['7-a.md', 'my own note.md', 'README.md'], '书名');
  assert.deepEqual(stale, []);
});

test('id prefixes are matched whole, not by string prefix', () => {
  // `7-` must not claim `70-…`; a substring match would delete another note.
  const planned = [f(7, '书名/7-a.md')];
  const stale = staleVaultFiles(planned, ['7-a.md', '70-other.md', '77-other.md'], '书名');
  assert.deepEqual(stale, []);
});

test('directories are independent', () => {
  // Same id can only live in one dir, but the listing passed in belongs to one
  // directory — a plan entry for another dir must not cause deletions here.
  const planned = [f(7, 'A书/7-new.md'), f(8, 'B书/8-new.md')];
  assert.deepEqual(staleVaultFiles(planned, ['8-old.md'], 'A书'), []);
  assert.deepEqual(staleVaultFiles(planned, ['8-old.md'], 'B书'), ['8-old.md']);
});

test('unknown directory yields nothing', () => {
  const planned = [f(7, 'A书/7-new.md')];
  assert.deepEqual(staleVaultFiles(planned, ['7-old.md'], 'C书'), []);
});

test('several renamed notes in one directory', () => {
  const planned = [f(1, 'D/1-x.md'), f(2, 'D/2-y.md')];
  const stale = staleVaultFiles(planned, ['1-x.md', '1-old.md', '2-old.md', '3-keep.md'], 'D');
  assert.deepEqual(stale.sort(), ['1-old.md', '2-old.md']);
});
