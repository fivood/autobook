/** PaddleOCR model profiles exposed by AutoBook. */
export type OcrModelProfile = 'v6-small' | 'v6-tiny' | 'v5-mobile' | 'v5-korean';

export const DEFAULT_OCR_MODEL_PROFILE: OcrModelProfile = 'v6-small';

export type OcrLanguage =
  | 'ch' | 'chinese_cht' | 'japan' | 'en' | 'korean'
  | 'french' | 'german' | 'es' | 'it' | 'pt' | 'nl' | 'pl'
  | 'da' | 'sv' | 'no' | 'cs' | 'ro' | 'hu' | 'tr' | 'vi';

/** Single source for every OCR language picker in settings, reader and workbench. */
export const OCR_LANGUAGE_OPTIONS: ReadonlyArray<{ code: OcrLanguage; labelKey: string }> = [
  { code: 'japan', labelKey: 'settings.translate.ocrLang.japan' },
  { code: 'ch', labelKey: 'settings.translate.ocrLang.ch' },
  { code: 'chinese_cht', labelKey: 'settings.translate.ocrLang.cht' },
  { code: 'en', labelKey: 'settings.translate.ocrLang.en' },
  { code: 'korean', labelKey: 'settings.translate.ocrLang.korean' },
  { code: 'french', labelKey: 'settings.translate.ocrLang.fr' },
  { code: 'german', labelKey: 'settings.translate.ocrLang.de' },
  { code: 'es', labelKey: 'settings.translate.ocrLang.es' },
  { code: 'it', labelKey: 'settings.translate.ocrLang.it' },
  { code: 'pt', labelKey: 'settings.translate.ocrLang.pt' },
  { code: 'nl', labelKey: 'settings.translate.ocrLang.nl' },
  { code: 'pl', labelKey: 'settings.translate.ocrLang.pl' },
  { code: 'da', labelKey: 'settings.translate.ocrLang.da' },
  { code: 'sv', labelKey: 'settings.translate.ocrLang.sv' },
  { code: 'no', labelKey: 'settings.translate.ocrLang.no' },
  { code: 'cs', labelKey: 'settings.translate.ocrLang.cs' },
  { code: 'ro', labelKey: 'settings.translate.ocrLang.ro' },
  { code: 'hu', labelKey: 'settings.translate.ocrLang.hu' },
  { code: 'tr', labelKey: 'settings.translate.ocrLang.tr' },
  { code: 'vi', labelKey: 'settings.translate.ocrLang.vi' }
];

/**
 * Keep this matrix in sync with @paddleocr/paddleocr-js. Version 0.4.2
 * supports four recognition languages on PP-OCRv5 and the shared CJK +
 * Latin model on PP-OCRv6. The bundled SDK currently has no Korean asset.
 */
const V5_LANGUAGES = new Set<OcrLanguage>(['ch', 'chinese_cht', 'japan', 'en']);
const V6_LANGUAGES = new Set<OcrLanguage>([
  'ch', 'chinese_cht', 'japan', 'en',
  'french', 'german', 'es', 'it', 'pt', 'nl', 'pl',
  'da', 'sv', 'no', 'cs', 'ro', 'hu', 'tr', 'vi'
]);

export const OCR_MODEL_PROFILES: ReadonlyArray<{
  id: OcrModelProfile;
  labelKey: string;
  hintKey: string;
}> = [
  { id: 'v6-small', labelKey: 'settings.ocr.model.v6Small', hintKey: 'settings.ocr.model.v6SmallHint' },
  { id: 'v6-tiny', labelKey: 'settings.ocr.model.v6Tiny', hintKey: 'settings.ocr.model.v6TinyHint' },
  { id: 'v5-mobile', labelKey: 'settings.ocr.model.v5Mobile', hintKey: 'settings.ocr.model.v5MobileHint' }
];

export function normalizeOcrModelProfile(value: string | null | undefined): OcrModelProfile {
  return OCR_MODEL_PROFILES.some((profile) => profile.id === value)
    ? value as OcrModelProfile
    : DEFAULT_OCR_MODEL_PROFILE;
}

export function isOcrLanguageSupported(lang: string, profile: OcrModelProfile): lang is OcrLanguage {
  if (profile === 'v5-korean') return lang === 'korean' || lang === 'en';
  return (profile === 'v5-mobile' ? V5_LANGUAGES : V6_LANGUAGES).has(lang as OcrLanguage);
}

/** Values passed to PaddleOCR.create. Explicit model names select v6-tiny. */
export function getOcrModelCreateOptions(profile: OcrModelProfile): Record<string, string> {
  if (profile === 'v5-mobile') return { ocrVersion: 'PP-OCRv5' };
  if (profile === 'v6-tiny') {
    return {
      ocrVersion: 'PP-OCRv6',
      textDetectionModelName: 'PP-OCRv6_tiny_det',
      textRecognitionModelName: 'PP-OCRv6_tiny_rec'
    };
  }
  return { ocrVersion: 'PP-OCRv6' };
}

/**
 * Korean PP-OCRv5 recognition model (official, det model shared with v5).
 * The paddleocr-js SDK ships no Korean asset and rejects `lang:"korean"`,
 * so the korean profile is constructed with an explicit rec asset and no
 * `lang` — see getOcrInstance. URL pattern matches Paddle's official model
 * server used by DEFAULT_MODEL_ASSETS.
 */
export const KOREAN_REC_MODEL_URL =
  'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/korean_PP-OCRv5_mobile_rec_onnx_infer.tar';

export function isKoreanProfile(profile: OcrModelProfile): boolean {
  return profile === 'v5-korean';
}

/** Stable identifier for cache namespaces and diagnostics. */
export function ocrModelCacheId(profile: OcrModelProfile): string {
  return `paddle-${profile}`;
}
