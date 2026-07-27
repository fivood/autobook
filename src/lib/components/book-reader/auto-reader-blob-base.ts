/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Shared engine for every "synthesize a whole sentence to an audio blob, then
 * play it" TTS backend (WinRT/SAPI, custom HTTP, Kokoro). Subclasses only
 * implement `synthesize()`.
 *
 * The reason this exists as a base class rather than three copies: all three
 * were strictly serial — synthesize, play, wait for `ended`, synthesize the
 * next one. The synthesis latency therefore landed *between* every pair of
 * sentences as audible dead air (a network round-trip for HTTP TTS, seconds
 * of WASM inference for Kokoro).
 *
 * Synthesis for the upcoming sentence starts the moment the current one
 * begins playing, so it runs inside the playback window instead of after it.
 * Measured against the old serial path with a stub engine, the gap between
 * one sentence ending and the next starting went from ~469ms to ~15ms — and
 * 15ms is the floor, being just the cost of handing a prepared element to
 * play(). It follows that the win scales with synthesis latency: the slower
 * the backend, the more of it disappears (up to the length of one sentence's
 * audio, after which the pipeline is simply saturated).
 *
 * What's cached is a decoded, ready-to-play <audio> element rather than the
 * raw Blob, which keeps createObjectURL and the decode out of the handoff too.
 *
 * Prefetch is deliberately shallow (`prefetchDepth`, default 1). Kokoro runs
 * ONNX on a single WASM thread shared with everything else; queuing many
 * sentences ahead would starve the one the user is waiting on.
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AutoReader } from './types';
import {
  computeGlobalCharIndex,
  extractText,
  seekSentencesToExplored,
  selectionToCharIndex,
  splitSentencesDetailed,
  type Sentence
} from './auto-reader-shared';

/** An <audio> that has already reached `canplaythrough` — `play()` on it is
 *  immediate, with no decode step left to pay for. */
interface PreparedAudio {
  audio: HTMLAudioElement;
  url: string;
}

/** Ceiling on how long we'll wait for `canplaythrough` before playing anyway.
 *  Some codecs never fire it for very short clips; `play()` still works, we
 *  just don't get the head start. */
const DECODE_WAIT_TIMEOUT_MS = 5000;

export abstract class BlobAutoReader implements AutoReader {
  wasReaderEnabled$ = new BehaviorSubject<boolean>(false);

  protected enabled$ = new BehaviorSubject<boolean>(false);

  protected sentences: Sentence[] = [];

  protected index = 0;

  protected offset = 0;

  protected contentEl: HTMLElement | undefined;

  protected _rate = 1;

  protected _voiceId = '';

  protected _lang = 'zh-CN';

  private audio: HTMLAudioElement | undefined;

  private currentToken = 0;

  private currentBlobUrl: string | undefined;

  /** index → in-flight or settled *decoded* audio for that sentence's full text. */
  private prefetched = new Map<number, Promise<PreparedAudio>>();

  /**
   * True when `synthesize()` bakes the speaking rate into the audio itself
   * (WinRT's SetSpeakingRate does). Those engines must NOT also get
   * `audio.playbackRate` — that applied the rate twice, so "1.5x" actually
   * played at 2.25x and "2x" at 4x. Engines without native rate control
   * leave this false and get playbackRate instead.
   */
  protected readonly synthesisHonorsRate: boolean = false;

  /** How many upcoming sentences to synthesize during playback. */
  protected prefetchDepth = 1;

  onBoundary?: (charIndex: number) => void;

  onEnd?: () => void;

  onError?: (message: string) => void;

  constructor(destroy$: Observable<void>) {
    this.enabled$.subscribe((v) => this.wasReaderEnabled$.next(v));
    destroy$.subscribe(() => this.off());
  }

  /** Produce audio for one sentence. `rate` is only meaningful to engines
   *  that set `synthesisHonorsRate`. */
  protected abstract synthesize(text: string, rate: number): Promise<Blob>;

  /** Return a message to block playback (e.g. model not downloaded yet). */
  protected canStart(): string | null {
    return null;
  }

  setContentEl(el: HTMLElement | undefined) {
    if (this.contentEl === el) return;
    this.contentEl = el;
    this.reset();
  }

  set rate(v: number) {
    const next = Math.max(0.5, Math.min(2, v));
    if (next === this._rate) return;
    this._rate = next;
    if (this.synthesisHonorsRate) {
      // Already-synthesized audio carries the old rate — drop it so upcoming
      // sentences are re-synthesized at the new one.
      this.clearPrefetch();
    } else if (this.audio) {
      this.audio.playbackRate = next;
    }
  }

  get rate() {
    return this._rate;
  }

  set voice(v: SpeechSynthesisVoice | undefined) {
    const next = v?.voiceURI ?? '';
    if (next === this._voiceId) return;
    this._voiceId = next;
    this.clearPrefetch();
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
    /* no-op — these engines pick their voice in settings */
  }

  prepare() {
    if (!this.contentEl) return;
    this.sentences = splitSentencesDetailed(extractText(this.contentEl));
    this.index = 0;
    this.offset = 0;
    this.clearPrefetch();
  }

  getPosition() {
    return { para: this.index, offset: this.offset };
  }

  setPosition(para: number, offset: number) {
    if (!this.sentences.length) return;
    this.index = Math.min(Math.max(0, para), this.sentences.length - 1);
    this.offset = Math.min(Math.max(0, offset), this.sentences[this.index].text.length);
    this.clearPrefetch();
  }

  getCurrentSentence(): { globalStart: number; globalEnd: number; text: string } | null {
    const sentence = this.sentences[this.index];
    if (!sentence) return null;
    return { globalStart: sentence.start, globalEnd: sentence.end, text: sentence.text };
  }

  seekToExplored(exploredCharCount: number) {
    const pos = seekSentencesToExplored(this.sentences, exploredCharCount);
    this.index = pos.index;
    this.offset = pos.offset;
    this.clearPrefetch();
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
    const blocked = this.canStart();
    if (blocked) {
      this.onError?.(blocked);
      return;
    }
    if (!this.sentences.length) this.prepare();
    if (!this.sentences.length) return;
    this.enabled$.next(true);
    this.speakNext();
  }

  off() {
    this.enabled$.next(false);
    this.currentToken += 1;
    this.stopAudio();
    this.clearPrefetch();
  }

  private stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = undefined;
    }
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = undefined;
    }
  }

  private static dispose(prepared: PreparedAudio) {
    prepared.audio.removeAttribute('src');
    prepared.audio.load();
    URL.revokeObjectURL(prepared.url);
  }

  /** Prefetched entries own an object URL each, so dropping the map isn't
   *  enough — every pending entry has to be released once it settles. */
  private clearPrefetch() {
    for (const pending of this.prefetched.values()) {
      pending.then(BlobAutoReader.dispose).catch(() => {});
    }
    this.prefetched.clear();
  }

  /** Synthesize and decode one sentence into a ready-to-play element. */
  private async prepareAudio(text: string): Promise<PreparedAudio> {
    const blob = await this.synthesize(text, this._rate);
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;

    await new Promise<void>((resolve) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener('canplaythrough', finish);
        audio.removeEventListener('error', finish);
        resolve();
      };
      // `error` also resolves: the failure surfaces properly from play()
      // below, and stalling the pipeline here would be worse.
      const timer = setTimeout(finish, DECODE_WAIT_TIMEOUT_MS);
      audio.addEventListener('canplaythrough', finish);
      audio.addEventListener('error', finish);
      audio.load();
    });

    return { audio, url };
  }

  private reset() {
    this.off();
    this.sentences = [];
    this.index = 0;
    this.offset = 0;
  }

  /**
   * Warm the next `prefetchDepth` sentences. Called once the current sentence
   * is already playing, so the work lands in the gap we're trying to remove
   * rather than in front of the audio the user is waiting for.
   */
  private schedulePrefetch(from: number) {
    for (let i = from; i < from + this.prefetchDepth && i < this.sentences.length; i += 1) {
      if (this.prefetched.has(i)) continue;
      const text = this.sentences[i].text;
      if (!text.trim()) continue;
      const promise = this.prepareAudio(text);
      // Mark handled so a failed prefetch never surfaces as an unhandled
      // rejection; the real error still propagates when it's consumed.
      promise.catch(() => {});
      this.prefetched.set(i, promise);
    }
  }

  /** Cached audio only applies when we're speaking the sentence in full —
   *  a resumed sentence is a different (sliced) string. */
  private audioFor(index: number, text: string, isFullSentence: boolean): Promise<PreparedAudio> {
    if (isFullSentence) {
      const hit = this.prefetched.get(index);
      if (hit) {
        this.prefetched.delete(index);
        return hit;
      }
    }
    return this.prepareAudio(text);
  }

  private async speakNext() {
    if (!this.enabled$.getValue()) return;
    if (this.index >= this.sentences.length) {
      this.off();
      this.onEnd?.();
      return;
    }

    const sentence = this.sentences[this.index];
    const isFullSentence = this.offset === 0;
    const text = sentence.text.slice(this.offset);
    if (!text.trim()) {
      this.index += 1;
      this.offset = 0;
      queueMicrotask(() => this.speakNext());
      return;
    }

    const globalIndex = computeGlobalCharIndex(this.sentences, this.index, this.offset);
    this.onBoundary?.(globalIndex);

    const token = ++this.currentToken;
    let prepared: PreparedAudio;
    try {
      prepared = await this.audioFor(this.index, text, isFullSentence);
    } catch (err: any) {
      if (token !== this.currentToken) return;
      const message = typeof err === 'string' ? err : err?.message ?? String(err);
      console.warn('[tts] synthesis failed:', message);
      this.onError?.(message);
      this.off();
      return;
    }
    if (token !== this.currentToken || !this.enabled$.getValue()) {
      BlobAutoReader.dispose(prepared);
      return;
    }

    this.stopAudio();

    const { audio, url } = prepared;
    // Set at play time rather than prepare time so a rate change made while
    // this element sat in the prefetch cache still takes effect.
    if (!this.synthesisHonorsRate) audio.playbackRate = this._rate;

    // These engines hand back one buffer per sentence with no word-level
    // timing, so the reading cursor is interpolated from playback position.
    // Page-flip (paginated) and typewriter reveal (continuous) both ride on
    // this, so it has to keep firing throughout the sentence, not just at
    // its start.
    const sentenceStart = globalIndex;
    const spokenLength = text.length;
    const resumeOffset = this.offset;
    let lastFraction = 0;
    audio.ontimeupdate = () => {
      if (token !== this.currentToken) return;
      const { duration } = audio;
      if (!duration || !Number.isFinite(duration) || duration <= 0) return;
      const fraction = Math.min(1, audio.currentTime / duration);
      if (fraction - lastFraction < 0.02) return;
      lastFraction = fraction;
      const spokenSoFar = Math.floor(spokenLength * fraction);
      // Anchor to where this utterance actually began. The old code assigned
      // the slice-relative offset straight into charOffset, so pausing after
      // a mid-sentence resume saved a position that resume then re-read as
      // sentence-relative — each pause/resume cycle crept backwards.
      this.offset = resumeOffset + spokenSoFar;
      this.onBoundary?.(sentenceStart + spokenSoFar);
    };
    audio.onended = () => {
      if (token !== this.currentToken) return;
      this.index += 1;
      this.offset = 0;
      this.speakNext();
    };
    audio.onerror = () => {
      if (token !== this.currentToken) return;
      this.onError?.('音频播放失败');
      this.off();
    };

    this.audio = audio;
    this.currentBlobUrl = url;

    try {
      await audio.play();
    } catch (err: any) {
      if (token !== this.currentToken) return;
      const message = typeof err === 'string' ? err : err?.message ?? String(err);
      console.warn('[tts] playback failed:', message);
      this.onError?.(message);
      this.off();
      return;
    }

    // Current sentence is now producing sound — synthesize ahead into its
    // playback window so the next one is ready the moment this ends.
    if (token === this.currentToken) this.schedulePrefetch(this.index + 1);
  }
}
