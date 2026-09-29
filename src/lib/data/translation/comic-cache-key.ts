/**
 * Stable OCR cache namespace for a comic.
 *
 * The OCR cache and page images live under `comic-cache/{key}/`. This key is
 * derived from the book identity (title + format + source language + OCR model) rather
 * than the translation job id, so re-entering the same book from the library
 * hits the cached OCR results instead of re-running the whole pipeline. The
 * job id stays a per-run UUID; the cache key is what makes re-entry cheap.
 *
 * Language and model profile are part of the key because switching either
 * must not reuse recognition results produced by a different model setup.
 */
export function comicCacheKey(
  title: string,
  fmt: string,
  sourceLanguage: string,
  ocrModel = ''
): string {
  const value = [title, fmt, sourceLanguage, ocrModel].filter(Boolean).join('|').toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `comic_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
