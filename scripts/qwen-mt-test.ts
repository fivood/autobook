/**
 * Unit tests for QwenMtProvider request shaping.
 * Run: node --experimental-strip-types scripts/qwen-mt-test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QwenMtProvider } from '../src/lib/data/translation/qwen-mt-provider.ts';

function makeProvider(fetchImpl) {
  return new QwenMtProvider({ baseUrl: 'https://mt.example.com/v1', apiKey: 'k', fetchImpl });
}

test('Qwen-MT sends one request per segment with translation_options', async () => {
  const calls = [];
  const provider = makeProvider(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '번역됨' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const out = await provider.translate({
    model: 'qwen-mt-plus',
    sourceLanguage: 'ko',
    targetLanguage: 'zh',
    segments: [
      { id: 'a', source: '안녕', documentId: 'd', filePath: 'p', start: 0, end: 1, kind: 'text', contextPath: 'c', chapter: 'ch' },
      { id: 'b', source: '하세요', documentId: 'd', filePath: 'p', start: 0, end: 1, kind: 'text', contextPath: 'c', chapter: 'ch' }
    ],
    glossary: [{ id: 'g1', source: '안녕', target: '你好', rule: 'preferred', approved: true }]
  });

  assert.equal(calls.length, 2, 'one request per segment');
  assert.equal(calls[0].body.model, 'qwen-mt-plus');
  assert.deepEqual(calls[0].body.translation_options, {
    source_lang: 'Korean',
    target_lang: 'Chinese',
    terms: [{ source: '안녕', target: '你好' }]
  });
  assert.equal(calls[0].body.messages[0].role, 'user');
  assert.equal(calls[0].body.messages[0].content, '안녕');
  assert.equal(out.length, 2);
  assert.equal(out[0].segmentId, 'a');
  assert.equal(out[0].target, '번역됨');
});

test('Qwen-MT omits terms when glossary empty and maps short langs', async () => {
  let captured;
  const provider = makeProvider(async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await provider.translate({
    model: 'qwen-mt-plus',
    sourceLanguage: 'ja',
    targetLanguage: 'zh-CN',
    segments: [{ id: 'a', source: 'こんにちは', documentId: 'd', filePath: 'p', start: 0, end: 1, kind: 'text', contextPath: 'c', chapter: 'ch' }],
    glossary: []
  });
  assert.deepEqual(captured.translation_options, { source_lang: 'Japanese', target_lang: 'Chinese' });
});

test('Qwen-MT throws on empty response', async () => {
  const provider = makeProvider(async () => new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 }));
  await assert.rejects(() => provider.translate({
    model: 'qwen-mt-plus',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    segments: [{ id: 'a', source: 'hi', documentId: 'd', filePath: 'p', start: 0, end: 1, kind: 'text', contextPath: 'c', chapter: 'ch' }],
    glossary: []
  }), /empty translation/);
});
