/**
 * Model registry — the app's four external models in one place, so feature
 * entry points can tell the user what's missing and the settings page can
 * show status / progress / location / uninstall for each.
 *
 * Storage reality differs per model:
 *   - PaddleOCR: plain fetch into the browser HTTP cache; no cache-storage
 *     handle, so we track download via a fetch interceptor and treat the
 *     "downloaded" flag as the ready signal.
 *   - Kokoro: transformers.js Cache Storage; deletable via
 *     deleteKokoroCache, progress via kokoroLoadStatus$.
 *   - Ollama: a separate local process; the reader only probes it. Uninstall
 *     is a pointer to `ollama rm`, not something we do.
 *   - LaMa: IOPaint sidecar; the reader probes the endpoint. Uninstall is a
 *     pointer to the cache dir.
 */

export type ModelKind = 'ocr' | 'tts' | 'llm' | 'inpaint';

export interface ModelEntry {
  id: string;
  kind: ModelKind;
  nameKey: string;
  purposeKey: string;
  /** Where the model lives on disk / in the browser. */
  location: string;
  /** Approximate size; shown in the manager, empty when unknown. */
  size: string;
  /** How the reader decides whether this model is ready. */
  ready: () => Promise<boolean> | boolean;
  /** Deletes the model where possible; throws/returns false when manual. */
  uninstall?: (modelId?: string) => Promise<boolean>;
}

export const MODELS: ModelEntry[] = [
  {
    id: 'ocr-paddle',
    kind: 'ocr',
    nameKey: 'models.ocrPaddle',
    purposeKey: 'models.ocrPaddlePurpose',
    location: '浏览器 HTTP 缓存（不可直接访问，见指引）',
    size: '随档位而异（det+rec）',
    ready: async () => {
      const { ocrModelProfile$ } = await import('$lib/data/store');
      return isOcrDownloaded(ocrModelProfile$.getValue());
    },
    uninstall: async () => clearOcrDownloadedFlag()
  },
  {
    id: 'ocr-paddle-korean',
    kind: 'ocr',
    nameKey: 'models.ocrPaddleKorean',
    purposeKey: 'models.ocrPaddleKoreanPurpose',
    location: '浏览器 HTTP 缓存（不可直接访问，见指引）',
    size: '~16 MB（korean rec）',
    ready: async () => isOcrDownloaded('v5-korean'),
    uninstall: async () => clearOcrDownloadedFlag('v5-korean')
  },
  {
    id: 'tts-kokoro',
    kind: 'tts',
    nameKey: 'models.ttsKokoro',
    purposeKey: 'models.ttsKokoroPurpose',
    location: 'Cache Storage（按 HuggingFace repo 键控）',
    size: '~350 MB（q8 量化）',
    ready: async () => {
      const { kokoroModel$ } = await import('$lib/data/store');
      const { isKokoroDownloaded } = await import('$lib/components/book-reader/auto-reader-kokoro');
      return isKokoroDownloaded(kokoroModel$.getValue() as 'v1.0' | 'v1.1-zh');
    },
    uninstall: async (modelId?: string) => {
      const { deleteKokoroCache } = await import('$lib/components/book-reader/auto-reader-kokoro');
      const { kokoroModel$ } = await import('$lib/data/store');
      const id = (modelId || kokoroModel$.getValue()) as 'v1.0' | 'v1.1-zh';
      await deleteKokoroCache(id);
      return true;
    }
  },
  {
    id: 'llm-ollama',
    kind: 'llm',
    nameKey: 'models.llmOllama',
    purposeKey: 'models.llmOllamaPurpose',
    location: 'Ollama 数据目录（Windows: %USERPROFILE%\\.ollama\\models）',
    size: '按模型而异（数 GB）',
    ready: async () => {
      // Reuse the shared local probe — the AI panel already keeps it warm and
      // it handles CORS/unreachable consistently with the rest of the app.
      const { probeLocalModels } = await import('$lib/data/ai/local-model');
      const state = await probeLocalModels();
      return state.status === 'ready';
    }
  },
  {
    id: 'inpaint-lama',
    kind: 'inpaint',
    nameKey: 'models.inpaintLama',
    purposeKey: 'models.inpaintLamaPurpose',
    location: 'IOPaint 缓存（%USERPROFILE%\\.cache\\torch\\hub\\checkpoints）',
    size: '~196 MB',
    ready: async () => {
      const endpoint = (await import('$lib/data/store')).translateLamaEndpoint$.getValue().trim();
      if (!endpoint) return false;
      const { isLamaReachable } = await import('$lib/functions/comic-lama');
      return isLamaReachable(endpoint);
    }
  }
];

// ── PaddleOCR download tracking ────────────────────────────────────────
const LEGACY_OCR_DOWNLOADED_KEY = 'ocrModelsDownloaded';
const OCR_DOWNLOADED_KEY_PREFIX = 'ocrModelsDownloaded:';
const OCR_MODEL_URL_PATTERN = /(?:PP-OCRv(?:5|6)|korean_PP-OCRv5).*_onnx_infer\.tar/;

import type { OcrModelProfile } from '$lib/functions/file-loaders/pdf/ocr-options';

import { writable } from 'svelte/store';

export interface OcrDownloadProgress {
  downloading: boolean;
  loaded: number;
  total: number;
  /** Per-model totals keyed by url so det+rec show individually. */
  files: Array<{ name: string; loaded: number; total: number }>;
}

/** Live PaddleOCR model download progress (det + rec tarballs). */
export const ocrDownloadProgress$ = writable<OcrDownloadProgress>({
  downloading: false,
  loaded: 0,
  total: 0,
  files: []
});

export function isOcrDownloaded(profile: string = 'v6-small'): boolean {
  try {
    if (localStorage.getItem(`${OCR_DOWNLOADED_KEY_PREFIX}${profile}`) === '1') return true;
    // Versions before model profiles only shipped PP-OCRv5.
    return profile === 'v5-mobile' && localStorage.getItem(LEGACY_OCR_DOWNLOADED_KEY) === '1';
  } catch {
    return false;
  }
}

function clearOcrDownloadedFlag(profile?: string): boolean {
  try {
    if (profile) {
      localStorage.removeItem(`${OCR_DOWNLOADED_KEY_PREFIX}${profile}`);
      return true;
    }
    localStorage.removeItem(LEGACY_OCR_DOWNLOADED_KEY);
    localStorage.removeItem(`${OCR_DOWNLOADED_KEY_PREFIX}v5-mobile`);
    localStorage.removeItem(`${OCR_DOWNLOADED_KEY_PREFIX}v6-small`);
    localStorage.removeItem(`${OCR_DOWNLOADED_KEY_PREFIX}v6-tiny`);
    localStorage.removeItem(`${OCR_DOWNLOADED_KEY_PREFIX}v5-korean`);
    return true;
  } catch {
    return false;
  }
}

/** Mark PaddleOCR models as present (called when a create() succeeds). */
export function markOcrDownloaded(profile: OcrModelProfile) {
  try {
    localStorage.setItem(`${OCR_DOWNLOADED_KEY_PREFIX}${profile}`, '1');
  } catch {
    // Persist failure only loses the "downloaded" hint; OCR still works.
  }
}

/**
 * Wrap window.fetch to track PaddleOCR model downloads. Called once at app
 * boot (see +layout). Non-invasive: only observes requests whose URL matches
 * the PaddleOCR model tarballs, streams the response to measure progress into
 * `ocrDownloadProgress$`, and marks "downloaded" when all complete.
 */
export function installOcrFetchTracker(): () => void {
  if (typeof window === 'undefined' || !window.fetch || !('ReadableStream' in window)) return () => {};
  const orig = window.fetch.bind(window) as typeof fetch;
  const files = new Map<string, { loaded: number; total: number }>();
  let started = false;

  const publish = () => {
    const list = [...files.entries()].map(([name, f]) => ({
      name,
      loaded: f.loaded,
      total: f.total
    }));
    const total = list.reduce((s, f) => s + (f.total || 0), 0);
    const loaded = list.reduce((s, f) => s + f.loaded, 0);
    ocrDownloadProgress$.set({ downloading: started, loaded, total, files: list });
  };

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isOcrModel = OCR_MODEL_URL_PATTERN.test(url);
    const res = await orig(input, init);
    if (!isOcrModel || !res.ok || !res.body) return res;
    // Count progress on a *clone*, leaving the original body untouched for
    // PaddleOCR to consume. `res.blob()` would re-read the stream PaddleOCR
    // is also reading — breaking its download.
    const name = url.slice(url.lastIndexOf('/') + 1);
    const total = Number(res.headers.get('content-length')) || 0;
    files.set(name, { loaded: 0, total });
    started = true;
    publish();
    const reader = res.clone().body!.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const f = files.get(name);
          if (f) {
            f.loaded += value?.byteLength || 0;
            publish();
          }
        }
        const f = files.get(name);
        if (f) {
          if (!f.total) f.total = f.loaded;
          f.loaded = f.total;
        }
        publish();
        // v5/v6 profiles download det + rec (2 files); the Korean profile
        // downloads a single rec model. Finish when every tracked file is done
        // rather than assuming exactly two.
        const all = [...files.values()];
        if (all.length > 0 && all.every((x) => x.total > 0 && x.loaded >= x.total)) {
          ocrDownloadProgress$.set({ downloading: false, loaded: 0, total: 0, files: [] });
        }
      } catch {
        // Clone body read failed (e.g. cancelled) — stop tracking; original
        // response is unaffected.
        ocrDownloadProgress$.set({ downloading: false, loaded: 0, total: 0, files: [] });
      }
    })();
    return res;
  }) as typeof fetch;
  return () => {
    window.fetch = orig;
  };
}
