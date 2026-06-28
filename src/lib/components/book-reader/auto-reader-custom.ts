/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Custom HTTP TTS — sends each sentence to a user-configured endpoint and
 * plays the returned audio bytes via HTMLAudioElement. Settings live in
 * tts(Custom)* stores; the user fills URL, headers, body template and the
 * Rust side handles the actual HTTP call (so CORS / auth headers aren't a
 * problem).
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AutoReader } from './types';
import {
  ttsCustomAudioPath$,
  ttsCustomBody$,
  ttsCustomEndpoint$,
  ttsCustomHeaders$,
  ttsCustomMethod$,
  ttsCustomProxyUrl$
} from '$lib/data/store';
import {
  computeGlobalCharIndex,
  extractText,
  seekParagraphsToExplored,
  selectionToCharIndex,
  splitSentences
} from './auto-reader-shared';
import { wrapPcmAsWav } from '$lib/functions/pcm-to-wav';

export class AutoReaderCustom implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);
  private paragraphs: string[] = [];
  private paraIndex = 0;
  private charOffset = 0;
  private contentEl: HTMLElement | undefined;
  private _rate = 1;
  private _voiceId = '';
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
    if (this.contentEl === el) return;
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

  set voice(v: SpeechSynthesisVoice | undefined) {
    this._voiceId = v?.voiceURI ?? '';
  }

  get voice() {
    return this._voiceId ? ({ voiceURI: this._voiceId } as SpeechSynthesisVoice) : undefined;
  }

  set lang(v: string) {
    this._lang = v;
  }

  get lang() {
    return this._lang;
  }

  autoSelectVoice() {
    /* no-op */
  }

  prepare() {
    if (!this.contentEl) return;
    const text = extractText(this.contentEl);
    this.paragraphs = splitSentences(text);
    this.paraIndex = 0;
    this.charOffset = 0;
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

  toggle() {
    if (this.enabled$.getValue()) this.off();
    else this.on();
  }

  on() {
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

    const endpoint = ttsCustomEndpoint$.getValue().trim();
    if (!endpoint) {
      this.onError?.('请先在设置里填好自定义 TTS 端点');
      this.off();
      return;
    }

    let headersObj: Record<string, string> = {};
    try {
      const parsed = JSON.parse(ttsCustomHeaders$.getValue() || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        headersObj = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, String(v)])
        );
      }
    } catch (err: any) {
      this.onError?.(`自定义 TTS 请求头不是合法 JSON: ${err.message}`);
      this.off();
      return;
    }

    const globalIndex = computeGlobalCharIndex(this.paragraphs, this.paraIndex, this.charOffset);
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string>('custom_tts_synthesize', {
        endpoint,
        method: ttsCustomMethod$.getValue() || 'POST',
        headers: headersObj,
        bodyTemplate: ttsCustomBody$.getValue() || '',
        audioPath: ttsCustomAudioPath$.getValue() || null,
        proxyUrl: ttsCustomProxyUrl$.getValue() || null,
        text
      });
      if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      // Detect Gemini 2.5 Flash TTS responses which return headerless L16
      // PCM at 24kHz mono. The browser can't play raw PCM, so we slap a
      // standard WAV header in front of it. Other engines stream MP3 / WAV
      // bytes that browsers play out of the box.
      const audioPath = ttsCustomAudioPath$.getValue() || '';
      const isGeminiPcm =
        endpoint.includes('generativelanguage.googleapis.com') &&
        /inlineData\.data$/.test(audioPath);
      const blob = isGeminiPcm
        ? wrapPcmAsWav(bytes, 24000, 16, 1)
        : new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.playbackRate = this._rate;
      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      };
      // See auto-reader-sapi.ts for the rationale: custom-HTTP TTS also
      // returns one audio blob per paragraph with no granular timing, so
      // we synthesize boundaries from audio.currentTime to keep page-flip
      // logic in lockstep with playback.
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
        this.onError?.('音频播放失败');
        this.off();
      };
      this.audio = audio;
      this.currentBlobUrl = url;
      await audio.play();
    } catch (err: any) {
      if (token !== this.currentSpeakToken) return;
      const message = typeof err === 'string' ? err : err?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('[custom-tts] failed:', message);
      this.onError?.(message);
      this.off();
    }
  }
}
