/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Tesseract.js wrapper for OCRing scanned-PDF page images. Lazy-loads the
 * tesseract bundle (~7MB) + language data only when the user actually
 * clicks "Run OCR" so non-scan-PDF readers don't pay the cost.
 *
 * Languages are stored as Tesseract 4 codes joined by '+' for multi-lang
 * recognition. Common picks:
 *   - 'chi_sim'           pure Simplified Chinese
 *   - 'chi_tra'           Traditional Chinese
 *   - 'eng'               English
 *   - 'jpn'               Japanese
 *   - 'chi_sim+eng'       中英混排（最常见的国产扫描书）
 */

import { base } from '$app/paths';

export type OcrLanguage = string;

interface WorkerLike {
  recognize(image: Blob | ArrayBuffer | Uint8Array | HTMLImageElement | HTMLCanvasElement): Promise<{
    data: { text: string };
  }>;
  terminate(): Promise<void>;
}

let workerPromise: Promise<WorkerLike> | undefined;
let workerLang = '';

async function getWorker(lang: OcrLanguage): Promise<WorkerLike> {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) {
    // language changed — tear down and recreate
    const prev = workerPromise;
    workerPromise = undefined;
    prev.then((w) => w.terminate()).catch(() => {});
  }
  workerLang = lang;
  workerPromise = (async () => {
    const tesseract = await import('tesseract.js');
    const worker = await tesseract.createWorker(lang, undefined, await workerOptions());
    return worker as unknown as WorkerLike;
  })();
  return workerPromise;
}

/**
 * Tesseract's defaults fetch the wasm core and the language models from a
 * public CDN at run time, which is the one thing in the app that silently
 * needs the network. If a packager (or the user) drops the files under
 * `static/tesseract/`, we use those instead and OCR works offline.
 *
 * Layout expected when present:
 *   static/tesseract/worker.min.js
 *   static/tesseract/tesseract-core-simd.wasm.js
 *   static/tesseract/<lang>.traineddata.gz
 */
async function workerOptions(): Promise<Record<string, string> | undefined> {
  const localBase = `${base}/tesseract`;
  try {
    const probe = await fetch(`${localBase}/worker.min.js`, { method: 'HEAD' });
    if (!probe.ok) return undefined;
  } catch {
    return undefined;
  }
  return {
    workerPath: `${localBase}/worker.min.js`,
    corePath: localBase,
    langPath: localBase
  };
}

/** True when OCR will have to pull its language model over the network. */
export async function ocrNeedsNetwork(): Promise<boolean> {
  return (await workerOptions()) === undefined;
}

export async function ocrImageBlob(blob: Blob, lang: OcrLanguage): Promise<string> {
  const worker = await getWorker(lang);
  const result = await worker.recognize(blob);
  return (result?.data?.text || '').trim();
}

export async function disposeOcrWorker() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    // ignore
  }
  workerPromise = undefined;
  workerLang = '';
}
