/**
 * The manual bookmark (B / 添加书签) shares its row with the auto-saved resume
 * position. The auto-bookmark used to overwrite it within seconds, so
 * 返回书签位置 led nowhere (Mac test R8). This guards the carry-over rule.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { manualBookmarkView, withManualBookmark } from '../src/lib/functions/manual-bookmark.ts';

const at = (exploredCharCount: number, extra = {}) => ({
  dataId: 7,
  exploredCharCount,
  progress: exploredCharCount / 3000,
  lastBookmarkModified: exploredCharCount,
  ...extra
});

test('B sets the mark at the saved position', () => {
  assert.equal(withManualBookmark(at(1018), undefined, true).manualExploredCharCount, 1018);
});

test('an auto save moves the resume position and keeps the mark', () => {
  const marked = withManualBookmark(at(1018), undefined, true);
  const later = withManualBookmark(at(2036, { scrollY: 900 }), marked, false);
  assert.equal(later.exploredCharCount, 2036);
  assert.equal(later.manualExploredCharCount, 1018);
  const view = manualBookmarkView(later)!;
  assert.equal(view.exploredCharCount, 1018);
  // The resume position's scroll offset must not steer the jump to the mark.
  assert.equal('scrollY' in view, false);
});

test('rows never marked behave as before', () => {
  const row = withManualBookmark(at(500), at(400), false);
  assert.equal('manualExploredCharCount' in row, false);
  assert.equal(manualBookmarkView(row), row);
  assert.equal(manualBookmarkView(undefined), undefined);
});

test('a mark at the very start (0) is a real mark', () => {
  const row = withManualBookmark(at(1200), withManualBookmark(at(0), undefined, true), false);
  assert.equal(manualBookmarkView(row)!.exploredCharCount, 0);
});
