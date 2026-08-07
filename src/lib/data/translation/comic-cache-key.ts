/**
 * Stable OCR cache namespace for a comic.
 *
 * The OCR cache and page images live under `comic-cache/{key}/`. This key is
 * derived from the book identity (title + format + source language) rather
 * than the translation job id, so re-entering the same book from the library
 * hits the cached OCR results instead of re-running the whole pipeline. The
 * job id stays a per-run UUID; the cache key is what makes re-entry cheap.
 *
 * Language is part of the key because Paddle det/rec model pairs are
 * language-specific — switching a book from japan to en must not reuse the
 * old results.
 */
export function comicCacheKey(title: string, fmt: string, sourceLanguage: string): string {
  const value = `${title}|${fmt}|${sourceLanguage}`.toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `comic_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
