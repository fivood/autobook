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
  kokoroAccepted$,
  kokoroLoadStatus$,
  kokoroVoiceId$,
  type KokoroLoadStatus
} from '$lib/data/store';

// Lazy-loaded once on first synth; cached for the lifetime of the page.
let ttsPromise: Promise<any> | null = null;

/** kokoro-js's TS bundle doesn't export the KokoroTTS class cleanly, so both
 *  the engine and the settings preview route through this single cast. */
export async function loadKokoroTtsClass(): Promise<any> {
  const mod = await import('kokoro-js');
  return (mod as any).KokoroTTS;
}

async function loadModel(onProgress: (status: KokoroLoadStatus) => void) {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    onProgress({ phase: 'loading', message: '正在加载 Kokoro-82M…', loaded: 0, total: 0 });
    const KokoroTTS = await loadKokoroTtsClass();
    if (!KokoroTTS?.from_pretrained) {
      throw new Error('kokoro-js 模块加载异常（未找到 KokoroTTS.from_pretrained）');
    }
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
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
    ttsPromise = null;
    onProgress({
      phase: 'errored',
      message: err?.message || String(err),
      loaded: 0,
      total: 0
    });
    throw err;
  });
  return ttsPromise;
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
    let tts: any;
    try {
      tts = await loadModel((status) => kokoroLoadStatus$.next(status));
    } catch (err: any) {
      throw new Error(`Kokoro 加载失败: ${err?.message || err}`);
    }

    // Validate the saved voice id against the model's actual voice list.
    // Stale ids (e.g. the zf_ Chinese voices v1.12.0's first cut wrongly
    // suggested) trip a hard failure inside kokoro.generate; rescue them here
    // so the user gets a working voice instead of a red error.
    let voiceId = kokoroVoiceId$.getValue() || 'af_heart';
    const voices = tts?.voices ? Object.keys(tts.voices) : [];
    if (voices.length && !voices.includes(voiceId)) {
      const fallback = voices.find((v) => v.startsWith('af_')) || voices[0];
      console.warn(`[kokoro] voice ${voiceId} not in model; fell back to ${fallback}`);
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
  await loadModel((s) => kokoroLoadStatus$.next(s));
}
