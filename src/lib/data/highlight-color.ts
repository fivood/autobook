import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';

/** The 4 highlight colors, in a stable display order. */
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'blue', 'green', 'pink'];

/** CSS background for each highlight color's dot/swatch. Centralized so the
 *  in-reader sidebar, notebook list, and note editor stay in sync. */
export const HIGHLIGHT_COLOR_DOT: Record<HighlightColor, string> = {
  yellow: 'rgba(255,235,59,0.8)',
  blue: 'rgba(100,181,246,0.7)',
  green: 'rgba(129,199,132,0.7)',
  pink: 'rgba(244,143,177,0.7)'
};
