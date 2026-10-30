/**
 * Unit tests for the language-routing pure-function layer.
 * Run: node --experimental-strip-types scripts/language-routing-test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isKorean,
  isChinese,
  isEuropean,
  isSupportedSource,
  ocrProfileFor,
  resolveLanguageRoute,
  validateRoute,
  type RouteInput
} from '../src/lib/data/translation/language-routing.ts';

function baseInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    sourceLanguage: 'ja',
    targetLanguage: 'zh',
    inputKind: 'comic',
    qualityMode: 'balanced',
    installedOcr: { 'v6-small': true, 'v5-korean': false, 'v6-tiny': true, 'v5-mobile': true },
    providers: { 'hy-mt2': { baseUrl: 'http://127.0.0.1:11434' }, qwenMt: { baseUrl: 'https://api.example.com/v1', apiKey: 'k' } },
    reviewModel: 'claude-sonnet',
    ...overrides
  };
}

test('language classification', () => {
  assert.ok(isKorean('ko'));
  assert.ok(isKorean('KO'));
  assert.ok(!isKorean('ja'));
  assert.ok(isChinese('zh-CN'));
  assert.ok(isEuropean('fr'));
  assert.ok(isEuropean('hu'));
  assert.ok(!isEuropean('tr'));
  assert.ok(!isEuropean('vi'));
  assert.ok(isSupportedSource('ko'));
  assert.ok(isSupportedSource('de'));
  assert.ok(isSupportedSource('tr'));
  assert.ok(isSupportedSource('zh'));
});

test('Korean always routes to the dedicated OCR profile', () => {
  const r = ocrProfileFor('ko', 'comic');
  assert.equal(r.profile, 'v5-korean');
  const r2 = ocrProfileFor('ko', 'text');
  assert.equal(r2.profile, 'v5-korean');
});

test('non-Korean routes to shared v6-small', () => {
  assert.equal(ocrProfileFor('ja', 'comic').profile, 'v6-small');
  assert.equal(ocrProfileFor('en', 'text').profile, 'v6-small');
  assert.equal(ocrProfileFor('fr', 'scanned-pdf').profile, 'v6-small');
});

test('Japanese comic → Chinese gets draft + review', () => {
  const route = resolveLanguageRoute(baseInput());
  assert.equal(route.needsTranslation, true);
  assert.equal(route.ocr?.profile, 'v6-small');
  assert.equal(route.draftTranslation?.provider, 'hy-mt2');
  assert.equal(route.draftTranslation?.model, 'Hy-MT2-7B');
  assert.equal(route.review?.model, 'claude-sonnet');
});

test('Chinese book does not translate itself', () => {
  const route = resolveLanguageRoute(baseInput({ sourceLanguage: 'zh', targetLanguage: 'zh' }));
  assert.equal(route.needsTranslation, false);
  assert.equal(route.draftTranslation, undefined);
  assert.equal(route.review, undefined);
  // Still needs OCR (comic), just no translation.
  assert.equal(route.ocr?.profile, 'v6-small');
});

test('quality mode selects Qwen-MT when configured', () => {
  const route = resolveLanguageRoute(baseInput({ qualityMode: 'quality' }));
  assert.equal(route.draftTranslation?.provider, 'qwen-mt');
  assert.equal(route.draftTranslation?.model, 'Qwen-MT-Plus');
});

test('fast mode picks tiny draft and no review', () => {
  const route = resolveLanguageRoute(baseInput({ qualityMode: 'fast' }));
  assert.equal(route.draftTranslation?.model, 'Hy-MT2-1.8B');
  assert.equal(route.review, undefined);
});

test('validateRoute fails Korean when model not installed (no silent fallback)', () => {
  const route = resolveLanguageRoute(baseInput({ sourceLanguage: 'ko' }));
  const r = validateRoute(route, baseInput({ sourceLanguage: 'ko' }));
  assert.equal(r.ok, false);
  assert.match(r.error || '', /Korean/);
});

test('validateRoute passes when Korean model installed', () => {
  const route = resolveLanguageRoute(baseInput({ sourceLanguage: 'ko' }));
  const r = validateRoute(route, baseInput({ sourceLanguage: 'ko', installedOcr: { ...baseInput().installedOcr, 'v5-korean': true } }));
  assert.equal(r.ok, true);
});

test('validateRoute fails draft when provider unconfigured', () => {
  const route = resolveLanguageRoute(baseInput());
  const r = validateRoute(route, baseInput({ providers: {} }));
  assert.equal(r.ok, false);
  assert.match(r.error || '', /未配置/);
});

test('Korean OCR never falls back to CJK even on text books', () => {
  const route = resolveLanguageRoute(baseInput({ sourceLanguage: 'ko', inputKind: 'text' }));
  assert.equal(route.ocr?.profile, 'v5-korean');
});
