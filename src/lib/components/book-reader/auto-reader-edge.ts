/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Microsoft Edge online voices engine. Per-sentence the frontend asks the
 * Rust side to synthesize MP3 (base64), then plays it via HTMLAudioElement.
 * Position memory is sentence-level (same as SAPI); seeking to mid-sentence
 * isn't possible because we hand whole sentences to the cloud at once.
 *
 * Network requirement: requires reach to speech.platform.bing.com. We don't
 * try to be clever about that — any synth error bubbles up and the engine
 * turns itself off, leaving the user free to fall back to SAPI / Web.
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

export class AutoReaderEdge implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);

  private paragraphs: string[] = [];

  private paraIndex = 0;

  private charOffset = 0;

  private contentEl: HTMLElement | undefined;

  private _rate = 1;

  private _voiceId = 'zh-CN-XiaoxiaoNeural';

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
    if (v?.voiceURI) this._voiceId = v.voiceURI;
  }

  get voice() {
    return { voiceURI: this._voiceId } as SpeechSynthesisVoice;
  }

  set lang(v: string) {
    this._lang = v;
  }

  get lang() {
    return this._lang;
  }

  autoSelectVoice() {
    /* no-op — voice picked explicitly via settings */
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

  toggle() {
    if (this.enabled$.getValue()) {
      this.off();
    } else {
      this.on();
    }
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
    this.releaseBlobUrl();
  }

  private reset() {
    this.off();
    this.paragraphs = [];
    this.paraIndex = 0;
    this.charOffset = 0;
  }

  private releaseBlobUrl() {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = undefined;
    }
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

    const globalIndex = computeGlobalCharIndex(
      this.paragraphs,
      this.paraIndex,
      this.charOffset
    );
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string>('edge_synthesize', {
        text,
        voice: this._voiceId,
        rate: this._rate
      });
      if (token !== this.currentSpeakToken || !this.enabled$.getValue()) return;

      const bytes = base64ToBytes(b64);
      const blob = new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.playbackRate = this._rate;
      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
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
      console.warn('[edge-tts] synth failed:', message);
      this.onError?.(message);
      this.off();
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
