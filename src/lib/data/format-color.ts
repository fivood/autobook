/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Colour identity for book formats — the tint behind a generated cover and
 * the chip on the card corner.
 *
 * Before this the palette was eight hard-coded hex pairs sitting inside
 * book-card.svelte, invented in 1.2.6 and extended ad hoc as formats were
 * added. Two problems came out of that: the colours could not follow the
 * active theme, and the "accent" tone got reused as a text background even
 * though it was designed as decoration on a dark field (white on it measures
 * 2.4:1–4.3:1, i.e. below WCAG AA for every format).
 *
 * So the source of truth is now a hue per format, and the lightness /
 * saturation that turn a hue into an actual colour are theme-dependent CSS
 * variables set in +layout.svelte. That keeps the "which format is this"
 * signal (hue) separate from the "does this read on the current theme"
 * decision (lightness), and means a theme can restyle every format at once
 * without touching this table.
 */

/**
 * Hues are spaced far enough apart to stay distinguishable at thumbnail size.
 * PDF stays red and MOBI stays orange because those associations already
 * exist for users; the rest just need to not collide.
 */
export const FORMAT_HUE: Record<string, number> = {
  pdf: 0,
  mobi: 25,
  txt: 45,
  md: 115,
  epub: 175,
  cbz: 210,
  htmlz: 280,
  /** Unknown / extension-less. Rendered de-saturated, so its hue barely shows. */
  book: 220
};

/** Formats that share another format's identity colour. */
const ALIASES: Record<string, string> = {
  azw: 'mobi',
  azw3: 'mobi',
  kfx: 'mobi',
  markdown: 'md',
  text: 'txt',
  // Comic containers are the same thing to a reader; the chip text still says
  // which archive it actually is.
  cbr: 'cbz',
  cb7: 'cbz',
  cbt: 'cbz'
};

/**
 * Map any format string (an `originalFormat` value, a file extension, a chip
 * label) onto a key in FORMAT_HUE. Unknown values fall back to `book`.
 */
export function formatColorKey(format: string | undefined): string {
  if (!format) return 'book';
  const key = format.toLowerCase();
  const resolved = ALIASES[key] || key;
  return resolved in FORMAT_HUE ? resolved : 'book';
}

/**
 * Saturation and lightness stops, split by whether the active theme is light
 * or dark. Only `cover*` follows the theme: a generated cover is a big block
 * of colour sitting in the grid next to real artwork, so on a light theme it
 * should not be a black hole.
 *
 * `chip*` deliberately does NOT follow the theme. The chip sits on top of
 * arbitrary cover art, not on the page background, so its contrast has
 * nothing to do with the theme — pinning it dark is what keeps white chip
 * text above 4.5:1 for every hue.
 */
export interface FormatColorStops {
  chipBgSaturation: number;
  chipBgLightness: number;
  chipRingSaturation: number;
  chipRingLightness: number;
  coverBgSaturation: number;
  coverBgLightness: number;
  coverAccentSaturation: number;
  coverAccentLightness: number;
  /** Opacity of the black gradient laid over the generated cover. */
  coverShade: number;
}

export const FORMAT_STOPS_DARK: FormatColorStops = {
  chipBgSaturation: 42,
  chipBgLightness: 22,
  chipRingSaturation: 45,
  chipRingLightness: 55,
  // Deep field, light wordmark. Solved for: the worst hue lands at 5.2:1.
  coverBgSaturation: 38,
  coverBgLightness: 22,
  coverAccentSaturation: 45,
  coverAccentLightness: 70,
  coverShade: 0.45
};

export const FORMAT_STOPS_LIGHT: FormatColorStops = {
  // Same chip treatment as dark: it never touches the page background.
  chipBgSaturation: 42,
  chipBgLightness: 24,
  chipRingSaturation: 48,
  chipRingLightness: 60,
  // Inverted: a pale tinted card with a dark wordmark. Simply lightening the
  // dark recipe does not work — a lighter cover and a light wordmark converge
  // and the label stops being readable (measured 2.6:1). Worst hue here is
  // 4.9:1.
  coverBgSaturation: 34,
  coverBgLightness: 88,
  coverAccentSaturation: 52,
  coverAccentLightness: 28,
  coverShade: 0.1
};

/**
 * Per-format saturation scale. `book` is the "we don't know" case and should
 * read as neutral slate rather than as another colour-coded format.
 */
export const FORMAT_SATURATION_SCALE: Record<string, number> = {
  book: 0.36
};

/**
 * Relative luminance of a CSS colour string, or null when it can't be parsed.
 * Only `#rgb`, `#rrggbb` and `rgb()/rgba()` appear in theme values, which is
 * what `themeObjValueToStringValue` emits.
 */
export function relativeLuminance(color: string): number | null {
  let r: number;
  let g: number;
  let b: number;

  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    const n = parseInt(full, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!rgb) return null;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }

  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick the stop set for a theme, from how bright its page background is. */
export function stopsForBackground(backgroundColor: string | undefined): FormatColorStops {
  const lum = backgroundColor ? relativeLuminance(backgroundColor) : null;
  // 0.18 sits between the darkest light theme and the lightest dark one in
  // the built-in set; custom themes get classified the same way.
  return lum !== null && lum >= 0.18 ? FORMAT_STOPS_LIGHT : FORMAT_STOPS_DARK;
}
