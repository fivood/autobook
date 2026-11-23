/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Guess a book's language from its text.
 *
 * Used when the file says nothing: .txt and .md have no metadata at all, and
 * plenty of EPUBs ship without a usable `dc:language`. Getting this wrong is
 * not cosmetic — the TTS voice is chosen per language, so an English book
 * that reads as Chinese gets a Chinese voice, which pronounces the words
 * roughly right and every number in Chinese.
 *
 * Two identical copies of this used to sit in load-txt.ts and load-md.ts.
 */

/** The slots the TTS voice memory keeps; see data/tts/voice-by-lang.ts. */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, 2000);
  const hiragana = (sample.match(/[぀-ゟ]/g) || []).length;
  const katakana = (sample.match(/[゠-ヿ]/g) || []).length;
  const cjk = (sample.match(/[一-鿿]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;
  const hangul = (sample.match(/[가-힣]/g) || []).length;

  // Kana is the only unambiguous signal: Japanese shares its kanji with
  // Chinese, so a few of them prove nothing, while a run of kana proves a lot.
  if (hiragana + katakana > 10) return 'ja';
  // Hangul is just as unambiguous. Without this a Korean TXT counted as
  // Chinese (no Latin, no kana) and was read with a Chinese voice.
  if (hangul > 10 && hangul > cjk) return 'ko';
  if (latin > cjk) return 'en';
  return 'zh';
}
