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
 * RGB channels of a CSS colour string, or null when it can't be parsed.
 * Only `#rgb`, `#rrggbb` and `rgb()/rgba()` appear in theme values, which is
 * what `themeObjValueToStringValue` emits.
 */
export function parseColor(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** Relative luminance of a CSS colour string, or null when it can't be parsed. */
export function relativeLuminance(color: string): number | null {
  const parsed = parseColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed;

  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two CSS colours, any alpha ignored; null if unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const rgbString = ([r, g, b]: [number, number, number]) =>
  `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/** `from` mixed toward `to` by t (0 = from, 1 = to). */
function mix(from: [number, number, number], to: [number, number, number], t: number): string {
  return rgbString([0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * t) as [number, number, number]);
}

/**
 * Smallest (or, with `furthest`, largest) t in [0, 1] whose mix from → to still
 * reads at `target` on `bg`. Assumes contrast changes monotonically along the
 * mix, which holds for a mix toward black, white, or the background itself.
 */
function searchMix(
  from: [number, number, number],
  to: [number, number, number],
  bg: string,
  target: number,
  furthest: boolean
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const t = (lo + hi) / 2;
    const ok = (contrastRatio(mix(from, to, t), bg) ?? 0) >= target;
    if (furthest ? ok : !ok) lo = t;
    else hi = t;
  }
  return furthest ? lo : hi;
}

/**
 * `color`, pushed toward black or white only as far as it takes to read at
 * `target` on `bg`. Keeps a semantic hue (the danger red) recognisable while
 * making it pass on whatever background the theme has.
 */
export function towardContrast(color: string, bg: string, target = 4.5): string {
  const c = parseColor(color);
  const b = parseColor(bg);
  if (!c || !b) return color;
  if ((contrastRatio(rgbString(c), bg) ?? 0) >= target) return rgbString(c);
  const bgLum = relativeLuminance(bg) ?? 0;
  const extreme: [number, number, number] = bgLum > 0.18 ? [0, 0, 0] : [255, 255, 255];
  return mix(c, extreme, searchMix(c, extreme, bg, target, false));
}

/**
 * The faintest version of `fg` that still reads at `target` on `bg` — the
 * colour for secondary text.
 *
 * Secondary text used to be the body colour at 40–70% opacity. Themes already
 * bake an alpha into the body colour (sage-green's text is 5.3:1 at full
 * strength), so the extra fade landed at 2–3:1. This fades only as far as each
 * theme can afford: a lot on the black-on-white theme, almost nothing on
 * sage-green. Hierarchy has to come from size and weight where it can't.
 */
export function mutedText(fg: string, bg: string, target = 4.8): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return fg;
  if ((contrastRatio(rgbString(f), bg) ?? 0) < target) return towardContrast(fg, bg, target);
  return mix(f, b, searchMix(f, b, bg, target, true));
}

/** The first candidate that reads at `target` on `bg`, else the most legible. */
export function readableOn(bg: string, candidates: string[], target = 4.5): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const c of candidates) {
    const ratio = contrastRatio(c, bg) ?? -1;
    if (ratio >= target) return c;
    if (ratio > bestRatio) {
      best = c;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Pick the stop set for a theme, from how bright its page background is. */
export function stopsForBackground(backgroundColor: string | undefined): FormatColorStops {
  const lum = backgroundColor ? relativeLuminance(backgroundColor) : null;
  // 0.18 sits between the darkest light theme and the lightest dark one in
  // the built-in set; custom themes get classified the same way.
  return lum !== null && lum >= 0.18 ? FORMAT_STOPS_LIGHT : FORMAT_STOPS_DARK;
}
