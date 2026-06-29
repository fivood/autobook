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
 *
 * Two output modes:
 *   - ocrImageBlob(blob, lang) → string (legacy, plain text)
 *   - ocrImageBlobHocr(blob, lang) → { hocr, text } (new, with per-word
 *     bbox coords for the transparent text overlay)
 */

export type OcrLanguage = string;

export interface OcrHocrResult {
  /** Tesseract HOCR HTML. Per-word <span class="ocrx_word"> with bbox coords. */
  hocr: string;
  /** Plain recognized text. Kept for the banner preview / fallback display. */
  text: string;
}

interface WorkerLike {
  recognize(
    image: Blob | ArrayBuffer | Uint8Array | HTMLImageElement | HTMLCanvasElement,
    options?: unknown,
    output?: { text?: boolean; hocr?: boolean; tsv?: boolean; box?: boolean }
  ): Promise<{
    data: { text: string; hocr?: string };
  }>;
  setParameters?(params: Record<string, string>): Promise<unknown>;
  terminate(): Promise<void>;
}

let workerPromise: Promise<WorkerLike> | undefined;
let workerLang = '';

async function getWorker(lang: OcrLanguage): Promise<WorkerLike> {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) {
    const prev = workerPromise;
    workerPromise = undefined;
    prev.then((w) => w.terminate()).catch(() => {});
  }
  workerLang = lang;
  workerPromise = (async () => {
    const tesseract = await import('tesseract.js');
    const worker = (await tesseract.createWorker(lang, undefined, {
      // Default CDN; cached by service worker / browser after first use
    })) as unknown as WorkerLike;
    // Suppress Tesseract's "insert a space between every recognized token"
    // habit. For CJK that produces a space between every character; for
    // mixed CJK+English we still want spaces between English words, which
    // Tesseract keeps even with this off (real interword whitespace from
    // the layout drives those, not the preserve flag).
    try {
      await worker.setParameters?.({ preserve_interword_spaces: '0' });
    } catch {
      // older builds may not expose setParameters; non-fatal
    }
    return worker;
  })();
  return workerPromise;
}

/** Plain-text OCR. Kept for the few legacy call sites; new code should use
 * `ocrImageBlobHocr` so we can build the transparent text layer. */
export async function ocrImageBlob(blob: Blob, lang: OcrLanguage): Promise<string> {
  const worker = await getWorker(lang);
  const result = await worker.recognize(blob);
  return (result?.data?.text || '').trim();
}

/** HOCR + plain text. HOCR gives us per-word `bbox X1 Y1 X2 Y2` coordinates
 * in image pixel space — fed to the text-layer builder so each word lands
 * exactly under its visual position on the scan. */
export async function ocrImageBlobHocr(blob: Blob, lang: OcrLanguage): Promise<OcrHocrResult> {
  const worker = await getWorker(lang);
  const result = await worker.recognize(blob, undefined, { text: true, hocr: true });
  return {
    hocr: result?.data?.hocr || '',
    text: (result?.data?.text || '').trim()
  };
}

/** Probe an image blob's intrinsic dimensions by loading it into a
 * detached <img>. Needed to build the text layer's coordinate space
 * (Tesseract bbox coords are in source pixels). */
export async function getBlobImageDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dim = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dim);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image dimension probe failed'));
    };
    img.src = url;
  });
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
