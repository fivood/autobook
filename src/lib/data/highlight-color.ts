import type { HighlightColor } from '$lib/data/database/books-db/versions/books-db';

/** The 4 highlight colors, in a stable display order. */
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'blue', 'green', 'pink'];

/** Single source of truth for the raw RGB tuples. Everything themed on
 *  highlight color (in-page mark background, sidebar dot, context-menu
 *  chip) derives from these — pick your own alpha per surface. */
export const HIGHLIGHT_COLOR_RGB: Record<HighlightColor, readonly [number, number, number]> = {
  yellow: [255, 235, 59],
  blue: [100, 181, 246],
  green: [129, 199, 132],
  pink: [244, 143, 177]
};

const rgba = (rgb: readonly [number, number, number], a: number) =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

/** In-reader text-mark background. Also mirrored as `rgba(var(--hl-*-rgb), 0.5)`
 *  in app.scss so `mark.hl-*` can render without a JS-set inline style. */
export const HIGHLIGHT_COLOR_MARK: Record<HighlightColor, string> = {
  yellow: rgba(HIGHLIGHT_COLOR_RGB.yellow, 0.5),
  blue: rgba(HIGHLIGHT_COLOR_RGB.blue, 0.5),
  green: rgba(HIGHLIGHT_COLOR_RGB.green, 0.5),
  pink: rgba(HIGHLIGHT_COLOR_RGB.pink, 0.5)
};

/** Context-menu color chip — pops slightly stronger than the mark so
 *  the picker reads as active choices, not selected text. */
export const HIGHLIGHT_COLOR_CHIP: Record<HighlightColor, string> = {
  yellow: rgba(HIGHLIGHT_COLOR_RGB.yellow, 0.6),
  blue: rgba(HIGHLIGHT_COLOR_RGB.blue, 0.5),
  green: rgba(HIGHLIGHT_COLOR_RGB.green, 0.5),
  pink: rgba(HIGHLIGHT_COLOR_RGB.pink, 0.5)
};

/** Sidebar / notebook color dot — highest alpha so it reads at 12–16px. */
export const HIGHLIGHT_COLOR_DOT: Record<HighlightColor, string> = {
  yellow: rgba(HIGHLIGHT_COLOR_RGB.yellow, 0.8),
  blue: rgba(HIGHLIGHT_COLOR_RGB.blue, 0.7),
  green: rgba(HIGHLIGHT_COLOR_RGB.green, 0.7),
  pink: rgba(HIGHLIGHT_COLOR_RGB.pink, 0.7)
};
