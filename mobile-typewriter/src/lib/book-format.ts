/**
 * The four formats this PWA can actually open, plus the colours that
 * identify them in the recents list.
 *
 * Deliberately much smaller than the desktop app's equivalent: the web build
 * only has PDF / EPUB / MD / TXT loaders (anything unrecognized falls through
 * to the text extractor), and there is no custom-theme system here — the page
 * follows `prefers-color-scheme`. So the light/dark split is done with a plain
 * media query in CSS rather than the desktop's luminance-classified themes,
 * and this module only has to name hues.
 */

export type BookFormat = 'pdf' | 'epub' | 'md' | 'txt';

/** Uppercase label shown on the thumbnail and in the meta line. */
export const FORMAT_LABEL: Record<BookFormat, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  md: 'MD',
  txt: 'TXT'
};

/**
 * Same hue choices as the desktop app so a user running both does not see two
 * different colours for the same format. Values are hues only — lightness and
 * saturation live in CSS so dark mode can flip them without JS.
 */
export const FORMAT_HUE: Record<BookFormat, number> = {
  pdf: 0,
  md: 115,
  epub: 175,
  txt: 45
};

/**
 * Recover the format from a filename. Used at import time; `loadFile` already
 * knows which branch it took, so this only has to agree with that dispatch.
 */
export function formatFromFileName(name: string): BookFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  return 'txt';
}
