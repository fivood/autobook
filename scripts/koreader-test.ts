/**
 * KOReader → AutoBook mapping. Guards:
 * 1. per-day fold uses AutoBook's start-of-day (a 3am session with
 *    startOfDay=4 belongs to the previous day),
 * 2. Lua parse pulls annotations even when the value has escaped quotes.
 *
 * findHighlightOffset needs a DOM and is exercised on the real app, not here.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { dayKeyForUnix, parseSidecar, sessionsToStatistics } from '../src/lib/functions/koreader.ts';

test('dayKeyForUnix respects a non-midnight start of day', () => {
  const d = new Date(2026, 8, 29, 3, 0, 0); // local 03:00
  const unix = Math.floor(d.getTime() / 1000);
  assert.equal(dayKeyForUnix(unix, 0), '2026-09-29');
  assert.equal(dayKeyForUnix(unix, 4), '2026-09-28');
});

test('sessionsToStatistics sums durations per date', () => {
  const now = Math.floor(new Date(2026, 8, 29, 12, 0, 0).getTime() / 1000);
  const stats = sessionsToStatistics(
    'X',
    [
      { startTime: now, duration: 30, totalPages: 100 },
      { startTime: now + 60, duration: 20, totalPages: 100 },
      { startTime: now + 86400, duration: 40, totalPages: 100 },
      { startTime: now + 100, duration: 0, totalPages: 100 } // skip
    ],
    0
  );
  assert.equal(stats.length, 2);
  assert.equal(stats[0].readingTime, 50);
  assert.equal(stats[1].readingTime, 40);
  assert.equal(stats[0].charactersRead, 0);
});

test('parseSidecar extracts title, percent and highlights', () => {
  const lua = `return {
    ["annotations"] = {
        [1] = {
            ["datetime"] = "2026-09-29 08:46:29",
            ["text"] = "拜占庭在\\"全盛\\"时期的领土",
        },
        [2] = {
            ["datetime"] = "2026-09-29 09:00:00",
            ["text"] = "another one",
        },
    },
    ["percent_finished"] = 0.065,
    ["partial_md5_checksum"] = "abc123",
    ["doc_props"] = { ["title"] = "奥斯曼帝国" },
    ["stats"] = { ["title"] = "奥斯曼帝国" },
  }`;
  const s = parseSidecar('/x.lua', lua);
  assert.equal(s.title, '奥斯曼帝国');
  assert.equal(s.md5, 'abc123');
  assert.equal(s.percentFinished, 0.065);
  assert.deepEqual(
    s.annotations.map((a) => a.text),
    ['拜占庭在"全盛"时期的领土', 'another one']
  );
});
