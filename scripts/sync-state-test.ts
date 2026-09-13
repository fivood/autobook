import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The sync worker's KV state is the only copy of a user's *cross-device*
 * reading history. It used to fall back to an empty state whenever the stored
 * blob failed to parse or carried an unexpected `v`, with a comment claiming
 * the client would rebuild it.
 *
 * The client does not rebuild it: buildPushPayload skips days it has already
 * pushed (it keeps its own contribution cache), so a reset loses this device's
 * history permanently and the other device's with it. The same branch would
 * have fired on the first read after any schema bump — every user at once.
 *
 * The worker itself pulls in Cloudflare types and a KV binding, so what is
 * pinned here is the decision table: which stored blobs are a new user, and
 * which must refuse rather than be overwritten. Keep it in step with
 * loadState in stats-sync/src/index.ts.
 */

class UnreadableState extends Error {}

/** Mirrors loadState's classification, minus the KV plumbing. */
function classify(raw: string | null): { kind: 'empty' | 'ok' } {
  if (!raw) return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UnreadableState('stored state is not valid JSON');
  }
  const candidate = parsed as { v?: unknown; books?: unknown } | null;
  if (!candidate || typeof candidate.books !== 'object' || candidate.books === null) {
    throw new UnreadableState('stored state has no books map');
  }
  if (candidate.v !== 1) {
    throw new UnreadableState(`stored state has unsupported version ${String(candidate.v)}`);
  }
  return { kind: 'ok' };
}

test('a missing key is a new user, not an error', () => {
  assert.deepEqual(classify(null), { kind: 'empty' });
  assert.deepEqual(classify(''), { kind: 'empty' });
});

test('a well-formed state loads', () => {
  assert.deepEqual(classify(JSON.stringify({ v: 1, books: {} })), { kind: 'ok' });
  assert.deepEqual(
    classify(JSON.stringify({ v: 1, books: { 'A Book': { '2026-01-01': { clients: {}, updatedAt: 1 } } } })),
    { kind: 'ok' }
  );
});

test('an unparseable blob refuses instead of resetting', () => {
  assert.throws(() => classify('{not json'), UnreadableState);
});

test('a blob with no books map refuses', () => {
  assert.throws(() => classify(JSON.stringify({ v: 1 })), UnreadableState);
  assert.throws(() => classify(JSON.stringify({ v: 1, books: null })), UnreadableState);
  assert.throws(() => classify('42'), UnreadableState);
});

test('a future schema version refuses instead of wiping everyone', () => {
  // The landmine: bump `v` in a later release and the old worker, still live
  // on some route, would have quietly emptied every state it read.
  assert.throws(() => classify(JSON.stringify({ v: 2, books: {} })), UnreadableState);
});
