import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampInt,
  estimateTokens,
  ollamaContextFor,
  trimHistory
} from '../src/lib/data/ai/chat-budget.ts';

const msg = (role: 'user' | 'assistant', n: number, tag = '') => ({ role, content: tag + 'x'.repeat(n) });

test('history keeps the newest turns and drops the oldest first', () => {
  const chat = [msg('user', 3000, 'q1'), msg('assistant', 3000, 'a1'), msg('user', 100, 'q2'), msg('assistant', 100, 'a2'), msg('user', 10, 'q3')];
  const kept = trimHistory(chat);
  assert.deepEqual(kept.map((m) => m.content.slice(0, 2)), ['q2', 'a2', 'q3']);
});

test('the question being asked is kept even when it alone blows the budget', () => {
  const kept = trimHistory([msg('user', 10), msg('assistant', 10), msg('user', 50_000, 'big')]);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].content.startsWith('big'));
});

test('never opens on an orphaned assistant reply', () => {
  const chat = [msg('user', 5500, 'q1'), msg('assistant', 900, 'a1'), msg('user', 10, 'q2')];
  assert.deepEqual(trimHistory(chat).map((m) => m.content.slice(0, 2)), ['q2']);
});

test('message count is capped too', () => {
  const chat = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 5));
  const kept = trimHistory(chat);
  assert.ok(kept.length <= 7);
  assert.equal(kept[0].role, 'user');
  assert.equal(kept.at(-1), chat.at(-1));
});

test('token estimate weighs CJK per character, Latin per ~4 chars', () => {
  assert.equal(estimateTokens('目前还没读到'), 6);
  assert.equal(estimateTokens('a'.repeat(35)), 10);
});

test('ollama context is rounded up and bounded', () => {
  assert.equal(ollamaContextFor(100, 100), 8192);
  assert.equal(ollamaContextFor(12000, 4096), 18432);
  assert.equal(ollamaContextFor(500_000, 4096), 32768);
});

test('settings clamp bad input back to something usable', () => {
  assert.equal(clampInt('abc', 256, 32000, 4096), 4096);
  assert.equal(clampInt(0, 256, 32000, 4096), 4096);
  assert.equal(clampInt(10, 256, 32000, 4096), 256);
  assert.equal(clampInt(99999, 256, 32000, 4096), 32000);
});
