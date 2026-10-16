/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * How much text playback has actually delivered, and by which engine.
 *
 * The reading tracker derives `charactersRead` from `exploredCharCount`, which
 * is a *position*, not a quantity read. That works while a person scrolls
 * forward and falls apart under playback: the sentence-follow scroll corrects
 * backwards, the viewport jumps when a section loads, and the delta goes
 * negative. Measured over 90 seconds of TTS on a real book: 20 sentences and
 * 669 characters actually spoken, recorded as **minus 719**.
 *
 * So while an engine is playing, the engine says how much it delivered. The
 * counter only ever grows; the tracker reads deltas off it.
 */

import { BehaviorSubject } from 'rxjs';

export type PlaybackMode = 'tts' | 'typewriter' | 'manual';

/** Which engine is producing reading right now. */
export const playbackMode$ = new BehaviorSubject<PlaybackMode>('manual');

/**
 * Monotonic count of characters delivered by playback, in the same units as
 * `charactersRead` (see `countPlaybackCharacters`).
 */
export const playbackCharacters$ = new BehaviorSubject<number>(0);

/**
 * The character class the statistics calculator counts — everything else is
 * punctuation and spacing it strips. Kept in step with
 * `get-character-count.ts`; a mismatch here would make the per-mode numbers
 * disagree with the totals they are supposed to break down.
 */
const NOT_COUNTED_REGEX =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}]+/gimu;

export function countPlaybackCharacters(text: string): number {
  return Array.from(text.replace(NOT_COUNTED_REGEX, '')).length;
}

/** Called by an engine each time it delivers more text. */
export function addPlaybackCharacters(text: string) {
  const n = countPlaybackCharacters(text);
  if (n > 0) playbackCharacters$.next(playbackCharacters$.getValue() + n);
}

export function setPlaybackMode(mode: PlaybackMode) {
  if (playbackMode$.getValue() !== mode) playbackMode$.next(mode);
}
