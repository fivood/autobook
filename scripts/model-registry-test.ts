/**
 * Unit tests for translation-model-registry capability scoring.
 * Run: node --experimental-strip-types scripts/model-registry-test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDraftModel, pickReviewModel, scoreDraftModel } from '../src/lib/data/translation/translation-model-registry.ts';
import type { ModelInfo } from 'translator-workbench';

const m = (id: string, parameterSize?: string): ModelInfo => ({ id, parameterSize });

test('draft prefers translation-specialized over larger general', () => {
  const models = [
    m('qwen2.5:14b', '14.8B'),
    m('hy-mt2:7b', '7B'),
    m('gemma3:12b', '12.2B')
  ];
  assert.equal(scoreDraftModel(models[0]), 514.8);
  assert.equal(scoreDraftModel(models[1]), 1000);
  assert.equal(scoreDraftModel(models[2]), 512.2);
  assert.equal(pickDraftModel(models)?.id, 'hy-mt2:7b');
});

test('draft falls back to largest when no translation model', () => {
  const models = [m('gemma3:12b', '12.2B'), m('qwen2.5:7b', '7.6B')];
  assert.equal(pickDraftModel(models)?.id, 'gemma3:12b');
});

test('draft returns undefined for empty list', () => {
  assert.equal(pickDraftModel([]), undefined);
});

test('review excludes translation-specialized', () => {
  const models = [m('hy-mt2:7b', '7B'), m('qwen2.5:14b', '14.8B')];
  assert.equal(pickReviewModel(models)?.id, 'qwen2.5:14b');
});

test('review falls back to any model if only translation models exist', () => {
  const models = [m('hy-mt2:7b', '7B'), m('hy-mt2:1.8b', '1.8B')];
  assert.equal(pickReviewModel(models)?.id, 'hy-mt2:7b');
});
