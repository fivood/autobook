/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Kokoro-82M offline TTS — runs an ONNX model entirely in WebView2 via
 * onnxruntime-web (bundled with kokoro-js). After first download the models
 * are cached by transformers.js / browser Cache API so subsequent launches
 * need no network.
 *
 * Playback, position tracking and prefetch live in BlobAutoReader. Inference
 * is seconds per sentence on the single WASM thread, which is precisely the
 * dead air the prefetch pipeline removes — but for the same reason the depth
 * stays at 1, so warming the next sentence never competes with the one
 * currently being waited on.
 *
 * Model loading is **opt-in**: nothing fetches until the user clicks
 * "下载并启用" in settings, which sets `kokoroAccepted$`.
 */

import { BlobAutoReader } from './auto-reader-blob-base';
import {
  KOKORO_MODEL_REPOS,
  kokoroAccepted$,
  kokoroLoadStatus$,
  kokoroModel$,
  kokoroVoiceId$,
  type KokoroLoadStatus,
  type KokoroModelId
} from '$lib/data/store';

// One in-flight/settled TTS instance per model id — switching Kokoro variant
// in settings invalidates the last one but keeps the earlier one cached in
// case the user flips back.
const ttsPromises = new Map<KokoroModelId, Promise<any>>();

/** kokoro-js's TS bundle doesn't export the KokoroTTS class cleanly, so both
 *  the engine and the settings preview route through this single cast. */
export async function loadKokoroTtsClass(): Promise<any> {
  const mod = await import('kokoro-js');
  return (mod as any).KokoroTTS;
}

async function loadModel(
  modelId: KokoroModelId,
  onProgress: (status: KokoroLoadStatus) => void
) {
  const cached = ttsPromises.get(modelId);
  if (cached) return cached;

  const repo = KOKORO_MODEL_REPOS[modelId] ?? KOKORO_MODEL_REPOS['v1.1-zh'];
  const promise = (async () => {
    onProgress({ phase: 'loading', message: `正在加载 Kokoro (${modelId})…`, loaded: 0, total: 0 });
    const KokoroTTS = await loadKokoroTtsClass();
    if (!KokoroTTS?.from_pretrained) {
      throw new Error('kokoro-js 模块加载异常（未找到 KokoroTTS.from_pretrained）');
    }
    const tts = await KokoroTTS.from_pretrained(repo, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: any) => {
        if (info?.status === 'progress' || info?.status === 'download') {
          onProgress({
            phase: 'loading',
            message: info?.file ? `下载 ${info.file}…` : '正在下载模型…',
            loaded: Number(info?.loaded || 0),
            total: Number(info?.total || 0)
          });
        }
      }
    });
    onProgress({ phase: 'ready', message: '', loaded: 0, total: 0 });
    return tts;
  })().catch((err) => {
    ttsPromises.delete(modelId);
    onProgress({
      phase: 'errored',
      message: err?.message || String(err),
      loaded: 0,
      total: 0
    });
    throw err;
  });
  ttsPromises.set(modelId, promise);
  return promise;
}

export class AutoReaderKokoro extends BlobAutoReader {
  /** No rate parameter in kokoro-js's generate() — base class uses playbackRate. */
  protected readonly synthesisHonorsRate = false;

  /** Inference is CPU-bound on one WASM thread; deeper prefetch would delay
   *  the sentence the listener is actually waiting for. */
  protected prefetchDepth = 1;

  protected canStart(): string | null {
    if (!kokoroAccepted$.getValue()) {
      return 'Kokoro 模型尚未下载。请在设置 → 阅读 → 朗读引擎 里点「下载并启用」';
    }
    return null;
  }

  protected async synthesize(text: string): Promise<Blob> {
    const modelId = (kokoroModel$.getValue() as KokoroModelId) || 'v1.1-zh';
    let tts: any;
    try {
      tts = await loadModel(modelId, (status) => kokoroLoadStatus$.next(status));
    } catch (err: any) {
      throw new Error(`Kokoro 加载失败: ${err?.message || err}`);
    }

    // Validate the saved voice id against the model's actual voice list. The
    // two model variants ship disjoint voice sets (v1.0 has af_heart etc.,
    // v1.1-zh has zf_/zm_ plus af_maple/af_sol/bf_vale), so a saved voice
    // from one is guaranteed invalid on the other — kokoro.generate would
    // throw. Prefer a Chinese voice on v1.1-zh, English (af_) on v1.0.
    let voiceId = kokoroVoiceId$.getValue();
    const voices = tts?.voices ? Object.keys(tts.voices) : [];
    if (voices.length && (!voiceId || !voices.includes(voiceId))) {
      const preferChinese = modelId === 'v1.1-zh';
      const fallback =
        (preferChinese
          ? voices.find((v) => v.startsWith('zf_')) || voices.find((v) => v.startsWith('zm_'))
          : voices.find((v) => v === 'af_heart') || voices.find((v) => v.startsWith('af_'))) ||
        voices[0];
      console.warn(`[kokoro] voice ${voiceId || '(unset)'} not in ${modelId}; fell back to ${fallback}`);
      voiceId = fallback;
      kokoroVoiceId$.next(voiceId);
    }

    const audioOut = await tts.generate(text, { voice: voiceId });

    // kokoro-js returns a RawAudio whose .toBlob() yields a WAV blob.
    return typeof audioOut?.toBlob === 'function'
      ? audioOut.toBlob()
      : new Blob([audioOut?.audio?.buffer || audioOut], { type: 'audio/wav' });
  }
}

/** Pre-warm the model so the first sentence doesn't wait for download. */
export async function ensureKokoroLoaded(): Promise<void> {
  if (!kokoroAccepted$.getValue()) return;
  const modelId = (kokoroModel$.getValue() as KokoroModelId) || 'v1.1-zh';
  await loadModel(modelId, (s) => kokoroLoadStatus$.next(s));
}
