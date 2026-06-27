/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Kokoro-82M offline TTS — runs an ONNX model entirely in WebView2 via
 * onnxruntime-web (bundled with kokoro-js). After first download the
 * models are cached by transformers.js / browser Cache API so subsequent
 * launches need no network.
 *
 * The engine class is identical in shape to AutoReaderCustom / Sapi: same
 * paragraphs[]/paraIndex/charOffset rhythm, same boundary interpolation
 * via audio.ontimeupdate so the v1.11.1 page-flip logic still works.
 *
 * Model loading is **opt-in**: nothing fetches until the user clicks the
 * "下载并启用" button in settings, which sets the `pdfKokoroAccepted$`
 * flag and the engine's first `on()` call kicks off the download.
 *
 * Hard rules:
 *   - Never download without explicit consent (kokoroAccepted flag)
 *   - Stream progress to a store so the UI can show MB/s + percentage
 *   - Cancel-safe: aborting the load shouldn't leave the engine half-loaded
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AutoReader } from './types';
import {
  computeGlobalCharIndex,
  extractText,
  seekParagraphsToExplored,
  selectionToCharIndex,
  splitSentences
} from './auto-reader-shared';
import {
  kokoroAccepted$,
  kokoroLoadStatus$,
  kokoroVoiceId$,
  type KokoroLoadStatus
} from '$lib/data/store';

// Lazy-loaded once on first synth; cached for the lifetime of the page.
let ttsPromise: Promise<any> | null = null;

async function loadModel(onProgress: (status: KokoroLoadStatus) => void) {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    onProgress({ phase: 'loading', message: '正在加载 Kokoro-82M…', loaded: 0, total: 0 });
    const mod = await import('kokoro-js');
    const KokoroTTS = (mod as any).KokoroTTS;
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

export class AutoReaderKokoro implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);
  private paragraphs: string[] = [];
  private paraIndex = 0;
  private charOffset = 0;
  private contentEl: HTMLElement | undefined;
  private _rate = 1;
  private _lang = 'zh-CN';
  private audio: HTMLAudioElement | undefined;
  private currentSpeakToken = 0;
  private currentBlobUrl: string | undefined;

  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;

  constructor(destroy$: Observable<void>) {
    this.enabled$.subscribe((v) => this.wasReaderEnabled$.next(v));
    destroy$.subscribe(() => this.off());
  }

  setContentEl(el: HTMLElement | undefined) {
    this.contentEl = el;
    this.reset();
  }

  set rate(v: number) {
    this._rate = Math.max(0.5, Math.min(2, v));
    if (this.audio) this.audio.playbackRate = this._rate;
  }
  get rate() {
    return this._rate;
  }

  // Kokoro voice ID lives in its own store; the standard `voice` setter
  // (which takes a SpeechSynthesisVoice) doesn't apply here.
  set voice(_v: SpeechSynthesisVoice | undefined) {
    /* no-op — see kokoroVoiceId$ */
  }
  get voice() {
    return undefined;
  }

  set lang(v: string) {
    this._lang = v;
  }
  get lang() {
    return this._lang;
  }

  autoSelectVoice() {
    /* no-op — voice is picked in settings */
  }

  prepare() {
    if (!this.contentEl) return;
    const text = extractText(this.contentEl);
    this.paragraphs = splitSentences(text);
    this.paraIndex = 0;
    this.charOffset = 0;
  }

  getPosition() {
    return { para: this.paraIndex, offset: this.charOffset };
  }

  setPosition(para: number, offset: number) {
    if (!this.paragraphs.length) return;
    this.paraIndex = Math.min(Math.max(0, para), this.paragraphs.length - 1);
    this.charOffset = Math.min(Math.max(0, offset), this.paragraphs[this.paraIndex].length);
  }

  getCurrentSentence(): { globalStart: number; globalEnd: number; text: string } | null {
    if (this.paraIndex >= this.paragraphs.length) return null;
    const text = this.paragraphs[this.paraIndex];
    const globalStart = computeGlobalCharIndex(this.paragraphs, this.paraIndex, 0);
    return { globalStart, globalEnd: globalStart + text.length, text };
  }

  seekToExplored(exploredCharCount: number) {
    const pos = seekParagraphsToExplored(this.paragraphs, exploredCharCount);
    this.paraIndex = pos.paraIndex;
    this.charOffset = pos.charOffset;
  }

  seekToSelection(): boolean {
    if (!this.contentEl) return false;
    const charIdx = selectionToCharIndex(this.contentEl);
    if (charIdx == null) return false;
    this.seekToExplored(charIdx);
    return true;
  }

  toggle() {
    if (this.enabled$.getValue()) this.off();
    else this.on();
  }

  on() {
    if (!kokoroAccepted$.getValue()) {
      this.onError?.('Kokoro 模型尚未下载。请在设置 → 阅读 → 朗读引擎 里点「下载并启用」');
      return;
    }
    if (!this.paragraphs.length) this.prepare();
    if (!this.paragraphs.length) return;
    this.enabled$.next(true);
    this.speakNext();
  }

  off() {
    this.enabled$.next(false);
    this.currentSpeakToken += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = undefined;
    }
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = undefined;
    }
  }

  private reset() {
    this.off();
    this.paragraphs = [];
    this.paraIndex = 0;
    this.charOffset = 0;
  }

  private async speakNext() {
    if (!this.enabled$.getValue()) return;
    if (this.paraIndex >= this.paragraphs.length) {
      this.off();
      this.onEnd?.();
      return;
    }

    const text = this.paragraphs[this.paraIndex].slice(this.charOffset);
    if (!text) {
      this.paraIndex += 1;
      this.charOffset = 0;
      this.speakNext();
      return;
    }

    const globalIndex = computeGlobalCharIndex(this.paragraphs, this.paraIndex, this.charOffset);
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;
    let tts: any;
    try {
      tts = await loadModel((status) => kokoroLoadStatus$.next(status));
    } catch (err: any) {
      if (token !== this.currentSpeakToken) return;
      this.onError?.(`Kokoro 加载失败: ${err?.message || err}`);
      this.off();
      return;
    }
    if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

    try {
      // Validate the saved voice id against the model's actual voice list.
      // Stale ids (e.g. the zf_ Chinese voices my v1.12.0 first cut wrongly
      // suggested) trip a hard failure inside kokoro.generate; rescue them
      // here so the user sees a working voice instead of a red error.
      let voiceId = kokoroVoiceId$.getValue() || 'af_heart';
      const voices = tts?.voices ? Object.keys(tts.voices) : [];
      if (voices.length && !voices.includes(voiceId)) {
        const fallback = voices.find((v) => v.startsWith('af_')) || voices[0];
        // eslint-disable-next-line no-console
        console.warn(`[kokoro] voice ${voiceId} not in model; fell back to ${fallback}`);
        voiceId = fallback;
        kokoroVoiceId$.next(voiceId);
      }
      const audioOut = await tts.generate(text, { voice: voiceId });
      if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

      // kokoro-js returns a RawAudio whose .toBlob() yields a WAV blob.
      const blob: Blob =
        typeof audioOut?.toBlob === 'function'
          ? audioOut.toBlob()
          : new Blob([audioOut?.audio?.buffer || audioOut], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.playbackRate = this._rate;
      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      };

      // Same boundary interpolation pattern as Sapi / Custom — Kokoro
      // returns one audio buffer per paragraph with no per-word events,
      // so synthesize boundaries from audio.currentTime to keep page-flip
      // logic in lockstep.
      const paraStartGlobalIndex = globalIndex;
      const paraLength = text.length;
      let lastReportedFraction = 0;
      audio.ontimeupdate = () => {
        if (token !== this.currentSpeakToken) return;
        if (!audio.duration || !isFinite(audio.duration) || audio.duration <= 0) return;
        const fraction = Math.min(1, audio.currentTime / audio.duration);
        if (fraction - lastReportedFraction < 0.02) return;
        lastReportedFraction = fraction;
        const localOffset = Math.floor(paraLength * fraction);
        this.charOffset = localOffset;
        this.onBoundary?.(paraStartGlobalIndex + localOffset);
      };
      audio.onended = () => {
        cleanup();
        if (token !== this.currentSpeakToken) return;
        this.paraIndex += 1;
        this.charOffset = 0;
        this.speakNext();
      };
      audio.onerror = () => {
        cleanup();
        if (token !== this.currentSpeakToken) return;
        this.onError?.('Kokoro 音频播放失败');
        this.off();
      };

      this.audio = audio;
      this.currentBlobUrl = url;
      await audio.play();
    } catch (err: any) {
      if (token !== this.currentSpeakToken) return;
      const message = typeof err === 'string' ? err : err?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('[kokoro] synth failed:', message);
      this.onError?.(message);
      this.off();
    }
  }
}

/** Pre-warm the model so the first sentence doesn't wait for download. */
export async function ensureKokoroLoaded(): Promise<void> {
  if (!kokoroAccepted$.getValue()) return;
  await loadModel((s) => kokoroLoadStatus$.next(s));
}
