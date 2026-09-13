/**
 * Four-language OCR + four translation-pair regression set.
 * Covers the scenario matrix: zh/en/ja/ko OCR profiles, and
 * en/ja/ko/eu → zh translation routing.
 * Run: node --experimental-strip-types scripts/four-lang-regression-test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ocrProfileFor,
  resolveLanguageRoute,
  isKorean,
  isJapanese,
  isEuropean,
  type RouteInput
} from '../src/lib/data/translation/language-routing.ts';

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    sourceLanguage: 'ja',
    targetLanguage: 'zh',
    inputKind: 'comic',
    qualityMode: 'balanced',
    installedOcr: { 'v6-small': true, 'v5-korean': true, 'v6-tiny': true, 'v5-mobile': true },
    providers: { 'hy-mt2': { baseUrl: 'http://127.0.0.1:11434' }, qwenMt: { baseUrl: 'https://mt.example.com/v1', apiKey: 'k' } },
    reviewModel: 'claude-sonnet',
    ...overrides
  };
}

test('OCR profile matrix: zh/en/ja → v6-small, ko → v5-korean, eu → v6-small', () => {
  assert.equal(ocrProfileFor('zh', 'comic').profile, 'v6-small');
  assert.equal(ocrProfileFor('en', 'comic').profile, 'v6-small');
  assert.equal(ocrProfileFor('ja', 'comic').profile, 'v6-small');
  assert.equal(ocrProfileFor('ko', 'comic').profile, 'v5-korean');
  assert.equal(ocrProfileFor('fr', 'comic').profile, 'v6-small');
  assert.equal(ocrProfileFor('de', 'scanned-pdf').profile, 'v6-small');
});

test('en → zh full route: draft + review', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'en' }));
  assert.equal(r.needsTranslation, true);
  assert.equal(r.ocr?.profile, 'v6-small');
  assert.equal(r.draftTranslation?.provider, 'hy-mt2');
  assert.equal(r.draftTranslation?.model, 'Hy-MT2-7B');
  assert.equal(r.review?.model, 'claude-sonnet');
});

test('ja → zh full route (comic)', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'ja' }));
  assert.equal(r.needsTranslation, true);
  assert.equal(r.ocr?.profile, 'v6-small');
  assert.equal(r.draftTranslation?.model, 'Hy-MT2-7B');
  assert.equal(r.review?.model, 'claude-sonnet');
});

test('ko → zh full route: korean OCR + draft + review', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'ko' }));
  assert.equal(r.needsTranslation, true);
  assert.equal(r.ocr?.profile, 'v5-korean');
  assert.equal(r.draftTranslation?.model, 'Hy-MT2-7B');
  assert.equal(r.review?.model, 'claude-sonnet');
});

test('eu (fr) → zh full route: shared OCR + draft + review', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'fr' }));
  assert.equal(r.needsTranslation, true);
  assert.equal(r.ocr?.profile, 'v6-small');
  assert.equal(r.draftTranslation?.model, 'Hy-MT2-7B');
  assert.equal(r.review?.model, 'claude-sonnet');
});

test('zh book: OCR only, no draft/review (no self-translation)', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'zh', targetLanguage: 'zh' }));
  assert.equal(r.needsTranslation, false);
  assert.equal(r.draftTranslation, undefined);
  assert.equal(r.review, undefined);
  assert.equal(r.ocr?.profile, 'v6-small');
});

test('language classification spot checks for the four + eu groups', () => {
  assert.ok(isKorean('ko'));
  assert.ok(isJapanese('ja'));
  assert.ok(isEuropean('de'));
  assert.ok(isEuropean('hu'));
  assert.ok(isEuropean('ro'));
  assert.ok(isEuropean('da'));
  // Turkish/Vietnamese are secondary, not "European".
  assert.ok(!isEuropean('tr'));
  assert.ok(!isEuropean('vi'));
});

test('quality mode on ja → zh picks Qwen-MT', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'ja', qualityMode: 'quality' }));
  assert.equal(r.draftTranslation?.provider, 'qwen-mt');
  assert.equal(r.draftTranslation?.model, 'Qwen-MT-Plus');
});

test('fast mode on en → zh: tiny draft, no review', () => {
  const r = resolveLanguageRoute(input({ sourceLanguage: 'en', qualityMode: 'fast' }));
  assert.equal(r.draftTranslation?.model, 'Hy-MT2-1.8B');
  assert.equal(r.review, undefined);
});
