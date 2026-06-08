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

export interface AutoReader {
  wasReaderEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  off: () => void;
}

const SENTENCE_DELIMITER = /([。！？；.!?;\n]+)/;

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
    this.contentEl = el;
    this.reset();
  }

  set rate(v: number) {
    this._rate = Math.max(0.5, Math.min(2, v));
  }

  get rate() {
    return this._rate;
  }

  set voice(v: SpeechSynthesisVoice | undefined) {
    this._voice = v;
  }

  get voice() {
    return this._voice;
  }

  set lang(v: string) {
    this._lang = v;
  }

  prepare() {
    if (!this.contentEl) return;
    const text = this.extractText(this.contentEl);
    this.paragraphs = this.splitSentences(text);
    this.paraIndex = 0;
    this.charOffset = 0;
  }

  seekToExplored(exploredCharCount: number) {
    let acc = 0;
    for (let i = 0; i < this.paragraphs.length; i++) {
      const len = this.paragraphs[i].length;
      if (acc + len > exploredCharCount) {
        this.paraIndex = i;
        this.charOffset = exploredCharCount - acc;
        return;
      }
      acc += len;
    }
    this.paraIndex = this.paragraphs.length;
    this.charOffset = 0;
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
      this.utterance = null;
    }
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

    const text = this.paragraphs[this.paraIndex];
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = this._rate;
    utt.lang = this._lang;
    if (this._voice) utt.voice = this._voice;

    const paraStartOffset = this.charOffset;

    utt.onboundary = (ev) => {
      if (ev.name === 'word' || ev.name === 'sentence') {
        const globalIndex = this.computeGlobalCharIndex(this.paraIndex, paraStartOffset + ev.charIndex);
        this.onBoundary?.(globalIndex);
      }
    };

    utt.onend = () => {
      this.paraIndex += 1;
      this.charOffset = 0;
      this.speakNext();
    };

    utt.onerror = (ev) => {
      if (ev.error !== 'canceled') {
        // eslint-disable-next-line no-console
        console.warn('[auto-reader] speech error:', ev.error);
      }
      this.off();
    };

    this.utterance = utt;
    this.synth.speak(utt);
  }

  private extractText(root: HTMLElement): string {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const parts: string[] = [];
    let node: Node | null = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent) {
        const tag = parent.tagName;
        if (tag !== 'SCRIPT' && tag !== 'STYLE' && !parent.classList.contains('tw-c')) {
          parts.push(node.textContent || '');
        }
      }
      node = walker.nextNode();
    }
    return parts.join('');
  }

  private splitSentences(text: string): string[] {
    const result: string[] = [];
    const parts = text.split(SENTENCE_DELIMITER);
    let buffer = '';
    for (let i = 0; i < parts.length; i++) {
      buffer += parts[i];
      if (SENTENCE_DELIMITER.test(parts[i]) || i === parts.length - 1) {
        const trimmed = buffer.trim();
        if (trimmed) result.push(trimmed);
        buffer = '';
      }
    }
    if (buffer.trim()) result.push(buffer.trim());
    return result;
  }

  private computeGlobalCharIndex(paraIndex: number, localIndex: number): number {
    let acc = 0;
    for (let i = 0; i < paraIndex; i++) {
      acc += this.paragraphs[i].length;
    }
    return acc + localIndex;
  }
}
