/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Which characters count toward the reader's position. Kept free of imports
 * so the rule can be unit-tested in plain Node (scripts/tts-voice-pick-test.ts).
 */

// Hangul was missing (the rule came from a Japanese-only reader), so a Korean
// book counted only its digits and Latin letters: progress stuck at 0%, and
// bookmarks / statistics / the TTS position mapping had nothing to go on.
// Books without Hangul count exactly as before.
export const isNotCountedRegex =
  /[^0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ\p{Radical}\p{Unified_Ideograph}\p{Script=Hangul}]+/gimu;

/** Whether one character counts toward the reader's position. */
export function isCountedCharacter(ch: string): boolean {
  return ch.replace(isNotCountedRegex, '') !== '';
}
