/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Web Speech API based auto-reader for continuous mode.
 * - extracts plain text from contentEl
 * - splits by sentence boundaries
 * - drives speechSynthesis with adjustable rate/voice
 * - reports charIndex via onBoundary for typewriter sync
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import {
  computeGlobalCharIndex,
  extractText,
  seekParagraphsToExplored,
  selectionToCharIndex,
  splitSentences
} from './auto-reader-shared';

export interface AutoReader {
  wasReaderEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  off: () => void;
}

export class AutoReaderContinuous implements AutoReader {
  private synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  private enabled$ = new BehaviorSubject<boolean>(false);

  private utterance: SpeechSynthesisUtterance | null = null;

  private paragraphs: string[] = [];

  private paraIndex = 0;

  private charOffset = 0;

  private contentEl: HTMLElement | undefined;

  private _rate = 1;

  private _voice: SpeechSynthesisVoice | undefined;

  private _lang = 'zh-CN';

  onBoundary?: (charIndex: number) => void;

  onEnd?: () => void;

  constructor(destroy$: Observable<void>) {
    this.enabled$.subscribe((v) => this.wasReaderEnabled$.next(v));
    destroy$.subscribe(() => this.off());
  }

  setContentEl(el: HTMLElement | undefined) {
    // Idempotent: re-running with the same element node (which the
    // continuous reader's $:{} block does on every prop change, including
    // multiplier ticks from the speed buttons) would otherwise reset()
    // the engine — which calls off() and emits a spurious
    // wasReaderEnabled=false. The +page.svelte subscriber then runs
    // autoScroller.revealAll(), the typewriter hits end-of-content, and
    // playback dies.
    if (this.contentEl === el) return;
    this.contentEl = el;
    this.reset();
  }

  set rate(v: number) {
    const next = Math.max(0.5, Math.min(2, v));
    if (next === this._rate) return;
    this._rate = next;
    this.restartIfSpeaking();
  }

  get rate() {
    return this._rate;
  }

  set voice(v: SpeechSynthesisVoice | undefined) {
    if (this._voice === v) return;
    this._voice = v;
    this.restartIfSpeaking();
  }

  get voice() {
    return this._voice;
  }

  set lang(v: string) {
    this._lang = v;
    this.autoSelectVoice();
  }

  get lang() {
    return this._lang;
  }

  autoSelectVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (!voices.length) return;

    // If current voice already matches lang, keep it
    if (this._voice && this._voice.lang.startsWith(this._lang)) return;

    const exact = voices.find((v) => v.lang === this._lang);
    if (exact) {
      this._voice = exact;
      return;
    }

    const prefix = voices.find((v) => v.lang.startsWith(this._lang));
    if (prefix) {
      this._voice = prefix;
      return;
    }

    if (this._lang === 'zh') {
      const zh = voices.find((v) => v.lang.startsWith('zh'));
      if (zh) {
        this._voice = zh;
        return;
      }
    }

    if (this._lang === 'ja') {
      const ja = voices.find((v) => v.lang.startsWith('ja'));
      if (ja) {
        this._voice = ja;
        return;
      }
    }
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
    if (this.enabled$.getValue()) {
      this.off();
    } else {
      this.on();
    }
  }

  on() {
    if (!this.synth) return;
    if (!this.paragraphs.length) this.prepare();
    if (!this.paragraphs.length) return;
    this.enabled$.next(true);
    this.speakNext();
  }

  off() {
    this.enabled$.next(false);
    if (this.synth) {
      this.synth.cancel();
    }
    if (this.utterance) {
      this.utterance.onboundary = null;
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance.onstart = null;
      this.utterance = null;
    }
  }

  private restartIfSpeaking() {
    if (!this.enabled$.getValue() || !this.synth) return;
    if (this.utterance) {
      this.utterance.onboundary = null;
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance.onstart = null;
      this.utterance = null;
    }
    this.synth.cancel();
    // resume from current paraIndex/charOffset
    queueMicrotask(() => {
      if (this.enabled$.getValue()) this.speakNext();
    });
  }

  private reset() {
    this.off();
    this.paragraphs = [];
    this.paraIndex = 0;
    this.charOffset = 0;
  }

  private speakNext() {
    if (!this.enabled$.getValue() || !this.synth) return;
    if (this.paraIndex >= this.paragraphs.length) {
      this.off();
      this.onEnd?.();
      return;
    }

    const text = this.paragraphs[this.paraIndex].slice(this.charOffset);
    // Skip empty / whitespace-only slices and roll forward. This triggers
    // when the cursor-start strategy lands the position at the end of a
    // paragraph — without this guard Web Speech rejects the empty
    // utterance with `invalid-argument`, which the error handler used to
    // treat as fatal and stop the whole session ("only one paragraph
    // reads then nothing"). SAPI / custom / Kokoro engines already do
    // this skip explicitly.
    if (!text || !text.trim()) {
      this.paraIndex += 1;
      this.charOffset = 0;
      queueMicrotask(() => this.speakNext());
      return;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = this._rate;
    utt.lang = this._lang;
    if (this._voice) utt.voice = this._voice;

    const paraStartOffset = this.charOffset;

    // Fire a synthetic boundary at the start of the utterance so page-flip
    // tracking works even on platforms (Win10 + old OneCore voices) where
    // SpeechSynthesisUtterance.onboundary never fires word-level events.
    const paraStartGlobalIndex = computeGlobalCharIndex(
      this.paragraphs,
      this.paraIndex,
      paraStartOffset
    );
    utt.onstart = () => {
      this.onBoundary?.(paraStartGlobalIndex);
    };

    utt.onboundary = (ev) => {
      if (ev.name === 'word' || ev.name === 'sentence') {
        const localIndex = paraStartOffset + ev.charIndex;
        this.charOffset = localIndex;
        const globalIndex = computeGlobalCharIndex(this.paragraphs, this.paraIndex, localIndex);
        this.onBoundary?.(globalIndex);
      }
    };

    utt.onend = () => {
      this.paraIndex += 1;
      this.charOffset = 0;
      this.speakNext();
    };

    utt.onerror = (ev) => {
      if (ev.error === 'canceled' || ev.error === 'interrupted') {
        return;
      }
      // Recoverable errors: skip this paragraph and try the next one
      // instead of killing the whole session. invalid-argument is the
      // common one we hit on empty / whitespace-only chunks after the
      // user restarts TTS with the cursor near a paragraph boundary.
      if (
        ev.error === 'invalid-argument' ||
        ev.error === 'text-too-long' ||
        ev.error === 'audio-busy'
      ) {
        console.warn('[auto-reader] speech recoverable error, skipping paragraph:', ev.error);
        this.paraIndex += 1;
        this.charOffset = 0;
        queueMicrotask(() => this.speakNext());
        return;
      }
      console.warn('[auto-reader] speech error:', ev.error);
      this.off();
    };

    this.utterance = utt;
    this.synth.speak(utt);
  }

}
