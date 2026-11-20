/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Which Web Speech voice to use when the user has not picked one.
 *
 * Taking the first voice whose language matches is what used to happen, and
 * on macOS that is the wrong one: the list also carries Apple's Eloquence and
 * novelty voices (Eddy, Grandpa, Reed, Rocko… under every major language
 * tag), they sort ahead of the system voice, and a Chinese book came out in a
 * cartoonish male voice — while 试听, which sets no voice, used the system
 * default and sounded fine. Same input, two different voices.
 */

// Eloquence voices (macOS 13+) and the old novelty/legacy voices. All of them
// carry real language tags; none is meant for reading a book.
const NOVELTY =
  /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph)\b/i;

// Apple's downloadable high-quality local voices put this in the name.
const HIGH_QUALITY = /\b(premium|enhanced)\b|增强|優化|优化|高品質/i;

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default' | 'localService'>;

function rank(v: VoiceLike): number {
  let score = 0;
  if (NOVELTY.test(v.name)) score -= 100;
  if (v.default) score += 10;
  if (HIGH_QUALITY.test(v.name)) score += 5;
  return score;
}

/** Best of `voices`, ties keeping list order; undefined for an empty list. */
export function bestWebVoice<T extends VoiceLike>(voices: T[]): T | undefined {
  let best: T | undefined;
  for (const v of voices) {
    if (!best || rank(v) > rank(best)) best = v;
  }
  return best;
}

/**
 * The voice to read `lang` with: an exact tag match first (`zh-CN` before
 * `zh-TW`), then any voice of the same language family.
 */
export function pickWebVoice<T extends VoiceLike>(voices: T[], lang: string): T | undefined {
  const tag = lang.toLowerCase();
  const family = tag.split('-')[0];
  const norm = (v: T) => v.lang.toLowerCase().replace('_', '-');
  return (
    bestWebVoice(voices.filter((v) => norm(v) === tag)) ??
    bestWebVoice(voices.filter((v) => norm(v).split('-')[0] === family))
  );
}

/**
 * Can this saved voice read `lang`? A slot nobody set falls back to the
 * pre-slot global voice, which is usually Chinese — handed a Korean book it
 * reads Hangul as noise. Multilingual voices read anything (same rule as
 * edgeFallbackVoice).
 */
export function voiceSpeaks(v: VoiceLike, lang: string): boolean {
  const family = lang.toLowerCase().split('-')[0];
  return v.lang.toLowerCase().replace('_', '-').split('-')[0] === family || /multilingual/i.test(v.name);
}
