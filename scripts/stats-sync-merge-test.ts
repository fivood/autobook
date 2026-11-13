/**
 * The cross-device statistics merge.
 *
 * Every bucket — total seconds, chars, and now the per-engine playback split —
 * merges by "max per device". That rule is what makes retries, stale clients
 * and out-of-order pushes harmless, and it is also the one place where a bug
 * silently eats the OTHER device's history: nothing throws, the number just
 * comes back smaller. 1.41.0 already lost histories once this way (the server
 * reset its state on an unreadable blob), so the rule gets a test.
 *
 * Covers both ends of the wire: the worker's `mergeInto` and the client's
 * `flattenRemote` / `sumModeField`.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeInto, type UserState } from '../stats-sync/src/index.ts';
import { flattenRemote, sumModeField } from '../src/lib/data/sync/sync-client.ts';

const A = 'deviceaaaa';
const B = 'devicebbbb';
const DAY = '2026-09-07';
const BOOK = '1848年欧洲革命';

function fresh(): UserState {
  return { v: 1, books: {} };
}

function push(state: UserState, entry: unknown, now = 1000) {
  return mergeInto(state, { books: { [BOOK]: { [DAY]: entry as never } } }, now);
}

function day(state: UserState) {
  return state.books[BOOK][DAY];
}

test('a first push stores totals and the playback split', () => {
  const state = push(fresh(), {
    clients: { [A]: 100 },
    charsClients: { [A]: 50 },
    modes: { [A]: { ttsSeconds: 60, ttsChars: 40 } }
  });
  assert.equal(day(state).clients[A], 100);
  assert.equal(day(state).charsClients?.[A], 50);
  assert.deepEqual(day(state).modes?.[A], { ttsSeconds: 60, ttsChars: 40 });
});

test('a device only ever moves its own numbers up', () => {
  let state = push(fresh(), {
    clients: { [A]: 100 },
    modes: { [A]: { ttsSeconds: 60, twSeconds: 10 } }
  });
  // A stale client re-reports an older, smaller day.
  state = push(state, { clients: { [A]: 40 }, modes: { [A]: { ttsSeconds: 5, twSeconds: 1 } } });
  assert.equal(day(state).clients[A], 100);
  assert.deepEqual(day(state).modes?.[A], { ttsSeconds: 60, twSeconds: 10 });
});

test('fields of one split move independently', () => {
  let state = push(fresh(), { clients: { [A]: 100 }, modes: { [A]: { ttsSeconds: 60 } } });
  state = push(state, { clients: { [A]: 140 }, modes: { [A]: { ttsSeconds: 60, twSeconds: 40 } } });
  assert.deepEqual(day(state).modes?.[A], { ttsSeconds: 60, twSeconds: 40 });
});

test('a client that sends no split (the PWA) leaves everyone else alone', () => {
  let state = push(fresh(), {
    clients: { [A]: 100 },
    charsClients: { [A]: 50 },
    modes: { [A]: { ttsSeconds: 60, ttsChars: 40 } }
  });
  state = push(state, { clients: { [B]: 30 }, charsClients: { [B]: 20 } });
  assert.equal(day(state).clients[A], 100);
  assert.equal(day(state).clients[B], 30);
  assert.deepEqual(day(state).modes?.[A], { ttsSeconds: 60, ttsChars: 40 });
  assert.equal(day(state).modes?.[B], undefined, 'no split invented for a device that sent none');
});

test('a day stored before splits existed accepts one later', () => {
  let state = push(fresh(), { clients: { [A]: 100 } });
  assert.equal(day(state).modes, undefined);
  state = push(state, { clients: { [A]: 100 }, modes: { [A]: { ttsSeconds: 90 } } });
  assert.deepEqual(day(state).modes?.[A], { ttsSeconds: 90 });
});

test('garbage is dropped, seconds are capped at a day', () => {
  const state = push(fresh(), {
    clients: { [A]: 999999 },
    modes: {
      [A]: { ttsSeconds: 999999, ttsChars: -5, twSeconds: Number.NaN, twChars: 1234 }
    }
  });
  assert.equal(day(state).clients[A], 86400);
  assert.equal(day(state).modes?.[A].ttsSeconds, 86400);
  assert.equal(day(state).modes?.[A].ttsChars, undefined);
  assert.equal(day(state).modes?.[A].twSeconds, undefined);
  assert.equal(day(state).modes?.[A].twChars, 1234, 'chars are not capped by the seconds cap');
});

test('updatedAt only moves when something actually changed', () => {
  let state = push(fresh(), { clients: { [A]: 100 } }, 1000);
  state = push(state, { clients: { [A]: 50 } }, 2000);
  assert.equal(day(state).updatedAt, 1000);
  state = push(state, { clients: { [A]: 150 } }, 3000);
  assert.equal(day(state).updatedAt, 3000);
});

test('the client flattens totals across devices and excludes itself from the split', () => {
  const state = push(
    push(fresh(), {
      clients: { [A]: 100 },
      charsClients: { [A]: 50 },
      modes: { [A]: { ttsSeconds: 60 } }
    }),
    { clients: { [B]: 30 }, charsClients: { [B]: 20 }, modes: { [B]: { ttsSeconds: 25 } } }
  );
  const [row] = flattenRemote(state as never);
  assert.equal(row.book, BOOK);
  assert.equal(row.totalSeconds, 130);
  assert.equal(row.totalChars, 70);
  // Pulling on device A must see only B's contribution, or A would double-count
  // its own seconds into its local row on every pull.
  assert.equal(sumModeField(row.modes, 'ttsSeconds', A), 25);
  assert.equal(sumModeField(row.modes, 'ttsSeconds', B), 60);
  assert.equal(sumModeField(row.modes, 'twSeconds', A), 0);
});
