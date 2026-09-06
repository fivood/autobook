/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * PaddleOCR.js wrapper for OCRing scanned-PDF page images. Lazy-loads the
 * SDK + ONNX models only on first call, so opening a normal text-mode book
 * doesn't pay the cost.
 *
 * Why Paddle (instead of Tesseract): the v1.13.0 internal benchmark
 * (`/ocr-bench`) on a typical Chinese scan showed Tesseract producing
 * obvious garbage on photo-heavy pages (`RERTEEAR HEH RARBRA X`,
 * `CEES PET FULT TT`) and treating the human portrait as text; Paddle
 * skipped the photo, detected only real text lines, and the recognized
 * Chinese was nearly faithful at comparable wall-clock time. v1.14.0
 * swaps the engine; the text-layer shape stays the same so existing
 * Tesseract-OCR'd books keep working.
 *
 * Models download from Baidu's BCE OS on first use (cached by the
 * browser's HTTP layer thereafter). ONNX Runtime Web wasm + sidecar mjs
 * are pre-copied to `static/vendor/ort/` by the postinstall script, so
 * `wasmPaths` can point at a static URL and Vite doesn't have to figure
 * out worker bundling on its own.
 *
 * Output granularity: one item per detected line (not per word / per
 * character like Tesseract HOCR). The text layer renders one `<span>`
 * per line; browsers split the selection per-character inside the span,
 * so partial-line copy still works — the visual selection rectangle is
 * just line-sized instead of char-sized. Acceptable trade for the
 * accuracy gain.
 */

import { pagePath } from '$lib/data/env';
import { markOcrDownloaded } from '$lib/data/models-registry';
import {
  getOcrModelCreateOptions,
  isOcrLanguageSupported,
  type OcrLanguage,
  type OcrModelProfile
} from './ocr-options';

export type { OcrLanguage, OcrModelProfile } from './ocr-options';

/** Public language codes the UI exposes. Map to Paddle's `lang` parameter
 * just before instantiation. */
/** Single corner of a Paddle polygon. PaddleOCR emits `[x, y]` tuples, NOT
 * `{ x, y }` objects — easy thing to get wrong. */
export type OcrPoint = [number, number];

export interface OcrLineItem {
  /** Recognized text for this line (Paddle joins words with appropriate
   * spacing; CJK has no inter-character spaces by default). */
  text: string;
  /** 4-point polygon in image pixel coords, top-left origin. Usually a
   * near-axis-aligned quadrilateral for printed text. */
  poly: OcrPoint[];
  /** Confidence score 0..1. */
  score: number;
}

export interface OcrPageResult {
  items: OcrLineItem[];
  /** Source image intrinsic dimensions, returned by the engine, so nothing
   * has to decode the blob a second time just to measure it (the runner uses
   * dims for the shell's `data-page-w/h`). */
  imageWidth: number;
  imageHeight: number;
  /** Best-effort plain-text concatenation, newline between lines,
   * primarily for the banner preview and progress callback. */
  text: string;
}

let ocrInstancePromise: Promise<unknown> | undefined;
let ocrInstanceLang: OcrLanguage | '' = '';
let ocrInstanceProfile: OcrModelProfile | '' = '';

interface PaddleOcrLike {
  predict(input: unknown): Promise<
    Array<{
      image?: { width: number; height: number };
      items: Array<{ poly: OcrPoint[]; text: string; score: number }>;
    }>
  >;
  dispose?(): Promise<void>;
}

async function getOcrInstance(lang: OcrLanguage, profile: OcrModelProfile): Promise<PaddleOcrLike> {
  if (!isOcrLanguageSupported(lang, profile)) {
    throw new Error(`当前 OCR 模型 ${profile} 不支持语言 ${lang}，请在 OCR 设置中更换语言或模型。`);
  }
  if (ocrInstancePromise && ocrInstanceLang === lang && ocrInstanceProfile === profile) {
    return ocrInstancePromise as Promise<PaddleOcrLike>;
  }
  if (ocrInstancePromise) {
    // Language changed — tear down the old instance and rebuild. Paddle
    // det/rec model pairs are language-specific.
    const prev = ocrInstancePromise as Promise<PaddleOcrLike>;
    ocrInstancePromise = undefined;
    prev.then((p) => p.dispose?.()).catch(() => {});
  }
  ocrInstanceLang = lang;
  ocrInstanceProfile = profile;
  ocrInstancePromise = (async () => {
    const mod = await import('@paddleocr/paddleocr-js');
    const { KOREAN_REC_MODEL_URL, isKoreanProfile } = await import('./ocr-options');
    // Korean has no SDK asset and `lang:"korean"` is rejected by paddleocr-js
    // (0.4.2 supports only ch/cht/en/japan). Build it with an explicit rec
    // asset and omit `lang` so the lang/ocrVersion validation is skipped; the
    // korean rec model carries its own dictionary. det stays the default v5.
    const createOptions = isKoreanProfile(profile)
      ? {
          textRecognitionModelName: 'korean_PP-OCRv5_mobile_rec',
          textRecognitionModelAsset: { url: KOREAN_REC_MODEL_URL },
          ortOptions: {
            backend: 'wasm',
            wasmPaths: `${pagePath}/vendor/ort/`,
            numThreads: 1
          }
        }
      : {
          lang,
          ...getOcrModelCreateOptions(profile),
          // ORT wasm/mjs are served as static files (see postinstall).
          //
          // We pin to single-thread WASM. WebGPU initialized cleanly on the
          // first attempt (Tauri WebView2 exposes it), but PP-OCRv5 ran
          // through onnxruntime-web's WebGPU EP returned 0 detection items
          // on the same image where WASM produced 25 — a known class of ORT
          // WebGPU issue where unsupported ops silently degrade to zero
          // output. ~25s/page on WASM beats ~4s/page of garbage on WebGPU.
          //
          // Multi-thread WASM would need SharedArrayBuffer + COOP/COEP,
          // which Tauri's dev URL doesn't serve; revisit when we want to
          // chase a 4-8x speedup with appropriate header config.
          ortOptions: {
            backend: 'wasm',
            wasmPaths: `${pagePath}/vendor/ort/`,
            numThreads: 1
          }
        };
    const created = await mod.PaddleOCR.create(createOptions);
    // create() resolving means det/rec models loaded — either freshly
    // downloaded (the fetch tracker counted them) or from an earlier session's
    // HTTP cache. Either way the model manager should show "ready".
    markOcrDownloaded(profile);
    // Log which backend ORT actually picked. Useful when diagnosing
    // why a particular machine is slow — `backend=wasm` + `webgpu=false`
    // means the GPU path isn't available so the user is on the slow
    // (~25s/page) CPU fallback. Tiny perf impact, kept always-on.
    try {
      const summary = (created as { getInitializationSummary?: () => unknown })
        .getInitializationSummary?.();
      if (summary) {
        console.info('[ocr] PaddleOCR init', { profile, lang, summary });
      }
    } catch {
      // ignore
    }
    return created as unknown as PaddleOcrLike;
  })();
  return ocrInstancePromise as Promise<PaddleOcrLike>;
}

/**
 * Run OCR on a single image blob. Returns the per-line items plus the
 * image's intrinsic dimensions — Paddle measures the image itself, so
 * the caller doesn't need a separate Image() probe.
 */
export async function ocrImageBlob(
  blob: Blob,
  lang: OcrLanguage,
  profile: OcrModelProfile
): Promise<OcrPageResult> {
  const ocr = await getOcrInstance(lang, profile);
  const results = await ocr.predict(blob);
  const r = Array.isArray(results) ? results[0] : results;
  if (!r) {
    return { items: [], imageWidth: 0, imageHeight: 0, text: '' };
  }
  const items: OcrLineItem[] = (r.items || []).map((it) => ({
    text: it.text,
    poly: it.poly,
    score: it.score
  }));
  const text = items.map((it) => it.text).join('\n');
  return {
    items,
    imageWidth: r.image?.width || 0,
    imageHeight: r.image?.height || 0,
    text
  };
}

/**
 * Kick off PaddleOCR model loading without running any prediction. Comic
 * OCR's ~10s first-run cost is almost all model init; warming it while the
 * user reads the pending-OCR card (or before auto-OCR fires) hides the
 * latency instead of making them stare at a spinner after hitting "Run".
 * Fire-and-forget — callers never await it.
 */
export function prewarmOcr(lang: OcrLanguage, profile: OcrModelProfile): void {
  getOcrInstance(lang, profile)
    .then(() => {
      // Instance cached module-level; nothing to surface.
    })
    .catch(() => {
      // Load failure surfaces on the real predict; prewarm must stay silent.
    });
}

export async function disposeOcrWorker() {
  if (!ocrInstancePromise) return;
  try {
    const instance = await ocrInstancePromise;
    await (instance as PaddleOcrLike).dispose?.();
  } catch {
    // ignore
  }
  ocrInstancePromise = undefined;
  ocrInstanceLang = '';
  ocrInstanceProfile = '';
}
