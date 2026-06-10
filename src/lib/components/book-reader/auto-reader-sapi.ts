/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * System TTS engine — uses Windows SAPI (via the `tts` Rust crate). Plays
 * audio outside the WebView so it keeps going even when the window is hidden.
 * Position tracking is sentence-level only: SAPI boundary events aren't
 * forwarded by the bridge yet, so resume snaps to the start of the current
 * sentence (close enough for human listeners and matches user expectation
 * when they explicitly pause to bookmark).
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AutoReader } from './types';
import {
  computeGlobalCharIndex,
  extractText,
  seekParagraphsToExplored,
  splitSentences
} from './auto-reader-shared';

export interface SapiVoice {
  id: string;
  name: string;
  language: string;
  gender?: string;
}

export class AutoReaderSapi implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);

  private paragraphs: string[] = [];

  private paraIndex = 0;

  private charOffset = 0;

  private contentEl: HTMLElement | undefined;

  private _rate = 1;

  private _voiceId = '';

  private _lang = 'zh-CN';

  private unlistenEnd?: () => void;

  private currentSpeakToken = 0;

  onBoundary?: (charIndex: number) => void;

  onEnd?: () => void;

  constructor(destroy$: Observable<void>) {
    this.enabled$.subscribe((v) => this.wasReaderEnabled$.next(v));
    destroy$.subscribe(() => {
      this.off();
      this.unlistenEnd?.();
      this.unlistenEnd = undefined;
    });
    this.attachEndListener();
  }

  setContentEl(el: HTMLElement | undefined) {
    this.contentEl = el;
    this.reset();
  }

  set rate(v: number) {
    this._rate = Math.max(0.5, Math.min(2, v));
  }

  get rate() {
    return this._rate;
  }

  /** Voice for SAPI is identified by URI string (id from sapi_list_voices). */
  set voice(v: SpeechSynthesisVoice | undefined) {
    this._voiceId = v?.voiceURI ?? '';
  }

  get voice() {
    // SAPI doesn't expose a SpeechSynthesisVoice; FAB only uses .voiceURI.
    return this._voiceId ? ({ voiceURI: this._voiceId } as SpeechSynthesisVoice) : undefined;
  }

  set lang(v: string) {
    this._lang = v;
  }

  get lang() {
    return this._lang;
  }

  // Web Speech parity — frontend code calls this on lang change. For SAPI the
  // FAB drives voice selection explicitly so we don't need to auto-pick here.
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
    this.stopRust();
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

    // Emit boundary at sentence start so position-save logic fires.
    const globalIndex = computeGlobalCharIndex(
      this.paragraphs,
      this.paraIndex,
      this.charOffset
    );
    this.onBoundary?.(globalIndex);

    const token = ++this.currentSpeakToken;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sapi_speak', {
        text,
        voiceId: this._voiceId || null,
        rate: this._rate
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sapi] speak failed:', err);
      if (token === this.currentSpeakToken) this.off();
    }
  }

  private async stopRust() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sapi_stop');
    } catch {
      /* ignore */
    }
  }

  private async attachEndListener() {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      this.unlistenEnd = await listen('sapi-utterance-end', () => {
        if (!this.enabled$.getValue()) return;
        this.paraIndex += 1;
        this.charOffset = 0;
        this.speakNext();
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sapi] failed to attach end listener:', err);
    }
  }
}
