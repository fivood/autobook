/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Windows system TTS engine. Rust side wraps WinRT SpeechSynthesizer (NOT
 * the `tts` crate, which only saw SAPI 5 voices and missed Windows 11's
 * Natural neural voices). Each sentence is synthesized to a WAV blob and
 * played here via HTMLAudioElement — same pattern as Edge.
 *
 * Position memory is sentence-level: synth happens whole-sentence and there
 * are no boundary callbacks back to the frontend, so resume snaps to the
 * current sentence's start.
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

export class AutoReaderSapi implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);
  private paragraphs: string[] = [];
  private paraIndex = 0;
  private charOffset = 0;
  private contentEl: HTMLElement | undefined;
  private _rate = 1;
  /** WinRT VoiceInformation.Id (a registry-style path). Empty = system default. */
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
    /* no-op — chosen via settings */
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

    const globalIndex = computeGlobalCharIndex(this.paragraphs, this.paraIndex, this.charOffset);
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string>('sapi_speak', {
        text,
        voiceId: this._voiceId || null,
        rate: this._rate
      });
      if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes as BlobPart], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.playbackRate = this._rate;
      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      };
      // Interpolated boundary: SAPI gives us one audio blob per paragraph
      // with no granular timing events, so for long paragraphs the
      // page-flip logic would otherwise lag until the next paraStart. We
      // approximate the cursor by linear interpolation across the audio's
      // currentTime, throttled to a couple of fires per second.
      const paraStartGlobalIndex = globalIndex;
      const paraLength = text.length;
      let lastReportedFraction = 0;
      audio.ontimeupdate = () => {
        if (token !== this.currentSpeakToken) return;
        if (!audio.duration || !isFinite(audio.duration) || audio.duration <= 0) return;
        const fraction = Math.min(1, audio.currentTime / audio.duration);
        if (fraction - lastReportedFraction < 0.02) return; // ~50 reports per paragraph
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
      console.warn('[sapi] synth failed:', message);
      this.onError?.(message);
      this.off();
    }
  }
}
