import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TAGS_PER_BOOK,
  mergeTags,
  newTagsOnly,
  parseTagResponse,
  remainingTagCapacity
} from '../src/lib/data/ai/auto-tag.ts';

/**
 * The auto-tag panel lists suggested tags, the reader ticks the ones they
 * want, and applyAutoTags writes them. The write goes through `mergeTags`,
 * which stops at MAX_TAGS_PER_BOOK — so a book already at the cap used to be
 * listed with tags to add, accept them, and write nothing: applyAutoTags sees
 * no length change, skips the row, and the panel reports 「已应用 0 本」 over
 * a list that plainly showed something to apply.
 *
 * The invariant these pin: every tag a suggestion offers must survive the
 * merge. Nothing is offered that cannot land.
 */

const fullBook = ['科幻', '太空歌剧', '硬科幻', '中国文学', '长篇', '获奖', '文明', '物理'];

test('a book at the cap has no room left', () => {
  assert.equal(fullBook.length, MAX_TAGS_PER_BOOK);
  assert.equal(remainingTagCapacity(fullBook), 0);
});

test('capacity is counted after dedupe, not on the raw list', () => {
  // Stored before the dedupe rules existed: three spellings, one tag.
  const withDupes = ['科幻', 'Science Fiction', 'science-fiction', 'SCIENCE FICTION'];
  assert.equal(mergeTags(withDupes, []).length, 2);
  assert.equal(remainingTagCapacity(withDupes), MAX_TAGS_PER_BOOK - 2);
});

test('an empty or missing list has the full cap available', () => {
  assert.equal(remainingTagCapacity(undefined), MAX_TAGS_PER_BOOK);
  assert.equal(remainingTagCapacity([]), MAX_TAGS_PER_BOOK);
});

test('every offered tag survives the merge — full book', () => {
  const offered = newTagsOnly(fullBook, ['末日']).slice(0, remainingTagCapacity(fullBook));
  assert.deepEqual(offered, [], 'a full book must be offered nothing');

  // And the guard applyAutoTags relies on agrees: nothing to write.
  assert.equal(mergeTags(fullBook, offered).length, fullBook.length);
});

test('every offered tag survives the merge — partial room', () => {
  const almost = fullBook.slice(0, MAX_TAGS_PER_BOOK - 2);
  const wanted = ['末日', '反乌托邦', '时间旅行', '黑暗森林'];
  const offered = newTagsOnly(almost, wanted).slice(0, remainingTagCapacity(almost));

  assert.equal(offered.length, 2, 'only what fits should be offered');
  const merged = mergeTags(almost, offered);
  assert.equal(merged.length, MAX_TAGS_PER_BOOK);
  for (const tag of offered) {
    assert.ok(merged.includes(tag), `${tag} was offered but did not land`);
  }
});

test('an ordinary book still gets its suggestions', () => {
  const existing = ['科幻'];
  const offered = newTagsOnly(existing, ['太空歌剧', '硬科幻']).slice(
    0,
    remainingTagCapacity(existing)
  );
  assert.deepEqual(offered, ['太空歌剧', '硬科幻']);
  assert.deepEqual(mergeTags(existing, offered), ['科幻', '太空歌剧', '硬科幻']);
});

/**
 * Wrapper tolerance. The prompt asks for `{"books":[…]}` and usually gets it,
 * but a real 14B model was observed answering with a bare `{"id":0,"tags":[…]}`
 * — one row, no envelope. Requiring the envelope threw the batch away and had
 * the job count it as a failure with a usable answer sitting right there.
 */
const batch = [
  { index: 0, title: '三体', author: '刘慈欣', subjectTags: [] },
  { index: 1, title: '人类简史', author: '尤瓦尔·赫拉利', subjectTags: [] }
];

test('the documented wrapper still works', () => {
  const out = parseTagResponse('{"books":[{"id":0,"tags":["科幻"]},{"id":1,"tags":["历史"]}]}', batch);
  assert.deepEqual(out.get(0), ['科幻']);
  assert.deepEqual(out.get(1), ['历史']);
});

test('a single unwrapped row is still usable', () => {
  // Observed verbatim from qwen2.5:14b.
  const out = parseTagResponse('{\n  "id": 0,\n  "tags": ["科幻", "硬科幻", "宇宙"]\n}', batch);
  assert.deepEqual(out.get(0), ['科幻', '硬科幻', '宇宙']);
  assert.equal(out.has(1), false, 'a book the model skipped keeps its baseline');
});

test('a bare array of rows is accepted', () => {
  const out = parseTagResponse('[{"id":1,"tags":["历史"]}]', batch);
  assert.deepEqual(out.get(1), ['历史']);
});

test('junk is still discarded', () => {
  assert.equal(parseTagResponse('抱歉，我不知道这些书。', batch).size, 0);
  assert.equal(parseTagResponse('{"result":"ok"}', batch).size, 0);
  assert.equal(parseTagResponse('{"id":"abc"}', batch).size, 0);
  // An id nobody asked about must not invent an entry.
  assert.equal(parseTagResponse('{"id":99,"tags":["x"]}', batch).size, 0);
});
