import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkBookText,
  buildIndex,
  searchIndex,
  extractRecentTail
} from '../src/lib/data/ai/bm25-index.ts';

/**
 * These offsets are a spoiler barrier, not bookkeeping. `retrieveSpoilerSafe`
 * decides what the AI may see by comparing `startChar` against how far the
 * reader has got, so an offset that reads low lets unread text through.
 *
 * Shaped like real input: htmlToPlaintext emits a newline before and after
 * every block element and then collapses runs, so paragraphs are separated by
 * two newlines — the exact gap the old cursor arithmetic under-counted.
 */
function samplePlaintext(paragraphs: number, filler = 60): string {
  return Array.from(
    { length: paragraphs },
    (_, i) => `第${i}段。` + '文'.repeat(filler)
  ).join('\n\n');
}

test('startChar is the real offset, not a reconstructed one', () => {
  const text = samplePlaintext(400);
  for (const chunk of chunkBookText(text)) {
    const firstParagraph = chunk.text.split('\n')[0];
    assert.equal(
      text.slice(chunk.startChar, chunk.startChar + firstParagraph.length),
      firstParagraph,
      `chunk ${chunk.id} does not start where it says it does`
    );
  }
});

test('endChar lands on the end of the last paragraph in the chunk', () => {
  const text = samplePlaintext(120);
  for (const chunk of chunkBookText(text)) {
    const lastParagraph = chunk.text.split('\n').at(-1) as string;
    assert.equal(
      text.slice(chunk.endChar - lastParagraph.length, chunk.endChar),
      lastParagraph,
      `chunk ${chunk.id} ends in the wrong place`
    );
  }
});

test('offsets do not drift as the book gets longer', () => {
  // The old bug was cumulative — one character lost per paragraph gap — so a
  // single short sample would have passed. This is the regression that counts.
  const text = samplePlaintext(400);
  const chunks = chunkBookText(text);
  const last = chunks.at(-1) as (typeof chunks)[number];
  const lastParagraph = last.text.split('\n')[0];
  assert.equal(text.indexOf(lastParagraph), last.startChar);
});

test('a chunk beyond the read cutoff never comes back from a search', () => {
  const text = samplePlaintext(400) + '\n\n结局：凶手是园丁。'.repeat(3);
  const chunks = chunkBookText(text);
  const index = buildIndex(chunks);

  // Half-read book: the ending must be unreachable.
  const cutoff = Math.floor(text.length / 2);
  for (const hit of searchIndex(index, '凶手 园丁 结局', { maxChar: cutoff, topK: 20 })) {
    assert.ok(hit.startChar < cutoff, `chunk ${hit.id} at ${hit.startChar} leaked past ${cutoff}`);
    assert.ok(!hit.text.includes('凶手'), 'the ending leaked into the results');
  }
});

test('the recent tail keeps the last chunk even when it exceeds the budget', () => {
  // One enormous paragraph — a single chunk far bigger than the tail budget.
  const text = '序章。\n\n' + '長'.repeat(5000);
  const chunks = chunkBookText(text);
  const tail = extractRecentTail(chunks, text.length, 2000);
  assert.ok(tail.length > 0, 'the tail went empty, so the model loses recent context');
  assert.equal(tail.at(-1)?.id, chunks.at(-1)?.id);
});

test('the tail still respects the budget when chunks are ordinary', () => {
  const text = samplePlaintext(200);
  const chunks = chunkBookText(text);
  const tail = extractRecentTail(chunks, text.length, 2000);
  const total = tail.reduce((sum, c) => sum + c.text.length, 0);
  assert.ok(tail.length > 1, 'expected several chunks to fit');
  assert.ok(total <= 2000 + (tail[0]?.text.length ?? 0), `tail ran to ${total} chars`);
});
