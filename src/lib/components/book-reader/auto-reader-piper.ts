/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Piper TTS engine — local neural network voices via a bundled piper.exe.
 * Tauri-only. Synthesis is per-sentence; the Rust side spawns piper.exe and
 * returns a base64 WAV that we play with HTMLAudioElement.
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AutoReader } from './types';
import {
  computeGlobalCharIndex,
  extractText,
  seekParagraphsToExplored,
  splitSentences
} from './auto-reader-shared';

export class AutoReaderPiper implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);
  private paragraphs: string[] = [];
  private paraIndex = 0;
  private charOffset = 0;
  private contentEl: HTMLElement | undefined;
  private _rate = 1;
  /** Absolute path to the currently selected .onnx voice file. */
  private _voiceFile = '';
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

  set voice(v: SpeechSynthesisVoice | undefined) {
    this._voiceFile = v?.voiceURI ?? '';
  }

  get voice() {
    return this._voiceFile ? ({ voiceURI: this._voiceFile } as SpeechSynthesisVoice) : undefined;
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

  getPosition() {
    return { para: this.paraIndex, offset: this.charOffset };
  }

  setPosition(para: number, offset: number) {
    if (!this.paragraphs.length) return;
    this.paraIndex = Math.min(Math.max(0, para), this.paragraphs.length - 1);
    this.charOffset = Math.min(Math.max(0, offset), this.paragraphs[this.paraIndex].length);
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

    if (!this._voiceFile) {
      this.onError?.('请先在设置里选择 Piper 音色文件');
      this.off();
      return;
    }

    const globalIndex = computeGlobalCharIndex(this.paragraphs, this.paraIndex, this.charOffset);
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string>('piper_synthesize', {
        text,
        voiceFile: this._voiceFile,
        rate: this._rate
      });
      if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes as BlobPart], { type: 'audio/wav' });
      if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = URL.createObjectURL(blob);

      const audio = new Audio(this.currentBlobUrl);
      audio.playbackRate = this._rate;
      audio.onended = () => {
        if (token !== this.currentSpeakToken) return;
        this.paraIndex += 1;
        this.charOffset = 0;
        this.speakNext();
      };
      audio.onerror = () => {
        if (token !== this.currentSpeakToken) return;
        this.onError?.('音频播放失败');
        this.off();
      };
      this.audio = audio;
      await audio.play();
    } catch (err: any) {
      if (token !== this.currentSpeakToken) return;
      const message = typeof err === 'string' ? err : err?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('[piper] synth failed:', message);
      this.onError?.(message);
      this.off();
    }
  }
}
