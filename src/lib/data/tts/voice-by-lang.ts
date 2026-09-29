/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Voice memory keyed by *book language*, not by book.
 *
 * The problem this solves: one global "current voice" per engine means a
 * Japanese novel opened after a Chinese one reads Japanese text with a
 * zh-CN voice until you go and change it back — and then the next Chinese
 * book is wrong. Per-book storage would fix that too, but every newly
 * imported book would still start on the wrong voice exactly once.
 *
 * Language is the axis that actually varies, and the books already carry it
 * (`bookData.language` from EPUB metadata / the txt loader), so three slots
 * per engine cover the whole library with no per-book bookkeeping and no
 * migration: an unset slot falls back to the engine's existing single-value
 * store, which is what every pre-1.36 install has.
 */

import { ttsVoiceByLang$ } from '$lib/data/store';

export const TTS_LANGS = ['zh', 'ja', 'en'] as const;

export type TtsLang = (typeof TTS_LANGS)[number];

/**
 * Map a book's language tag onto one of the three slots.
 *
 * Anything outside zh/ja/en lands on `zh` — that matches `AutoReader`'s own
 * `_lang = 'zh-CN'` default, so an untagged book behaves exactly as it did
 * before slots existed rather than silently switching to an English voice.
 */
export function langSlotOf(bookLanguage: string | undefined): TtsLang {
  const tag = (bookLanguage || '').toLowerCase();
  if (tag.startsWith('ja')) return 'ja';
  if (tag.startsWith('en')) return 'en';
  return 'zh';
}

function slotKey(engine: string, lang: TtsLang) {
  return `${engine}:${lang}`;
}

/** Pure form, for Svelte templates that need to re-render when the map does —
 *  they pass `$ttsVoiceByLang$` so the dependency is visible to the compiler. */
export function pickVoice(
  slots: Record<string, string>,
  engine: string,
  lang: TtsLang,
  fallback = ''
): string {
  return slots[slotKey(engine, lang)] || fallback;
}

/** The remembered voice for this engine + language, or `fallback` if unset. */
export function voiceForLang(engine: string, lang: TtsLang, fallback = ''): string {
  return pickVoice(ttsVoiceByLang$.getValue(), engine, lang, fallback);
}

export function setVoiceForLang(engine: string, lang: TtsLang, voiceId: string) {
  const next = { ...ttsVoiceByLang$.getValue() };

  if (voiceId) {
    next[slotKey(engine, lang)] = voiceId;
  } else {
    // Clearing a slot has to delete the key, not store '' — an empty string
    // would shadow the legacy single-value store forever.
    delete next[slotKey(engine, lang)];
  }

  ttsVoiceByLang$.next(next);
}
