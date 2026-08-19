import type { HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
// Relative, with the extension, so `scripts/highlight-slot-test.ts` can load
// this module under plain node (the `$lib` alias only exists inside Vite).
import { parseColor } from './format-color.ts';

/** The 4 highlight slots, in a stable display order. */
export const HIGHLIGHT_SLOTS: HighlightSlot[] = ['1', '2', '3', '4'];

/** The built-in hue palette. Only the `color` mode uses these directly; every
 *  surface reads the resolved styles instead (see `highlightSlotStyles`). */
export const HIGHLIGHT_SLOT_RGB: Record<HighlightSlot, readonly [number, number, number]> = {
  '1': [255, 235, 59],
  '2': [100, 181, 246],
  '3': [129, 199, 132],
  '4': [244, 143, 177]
};

/**
 * Slot ids as they were spelled before db v13.
 *
 * Kept because highlights cross the db boundary in both directions: the v12→v13
 * migration rewrites local rows, but `highlights_*.json` exports from a device
 * still on the old schema can be imported at any time. Without this an old
 * highlight lands with `color: 'yellow'`, matches no `mark.hl-*` rule, and gets
 * the browser's default opaque yellow — theme ignored, and ~1.6:1 text contrast
 * on the dark themes.
 */
export const LEGACY_SLOT_OF_COLOR: Record<string, HighlightSlot> = {
  yellow: '1',
  blue: '2',
  green: '3',
  pink: '4'
};

/** Coerce anything stored in a highlight's `color` field to a real slot. */
export function normalizeHighlightSlot(value: unknown): HighlightSlot {
  const raw = String(value);
  if ((HIGHLIGHT_SLOTS as string[]).includes(raw)) return raw as HighlightSlot;
  return LEGACY_SLOT_OF_COLOR[raw] ?? '1';
}

/**
 * How the four slots are painted.
 *
 * `color` is the historic hue-per-slot palette. `invert` exists because hue is
 * the one channel colour-blind readers can't use as a label: under deuteranopia
 * (~6% of men) the old green and pink sit 1.6 apart on a 0-255 scale, i.e.
 * indistinguishable. Luminance survives every form of colour blindness, so the
 * invert preset drops hue entirely and separates the slots by fill and
 * underline instead.
 */
export type HighlightPaletteMode = 'color' | 'invert' | 'custom';

export interface HighlightSlotStyle {
  /** `r, g, b` — ready to drop inside `rgb()` / `rgba()`. */
  rgb: string;
  /** Background wash alpha. */
  alpha: string;
  /** Underline width, `0` for none. */
  underlineWidth: string;
  underlineStyle: string;
  /** Text colour inside the mark; `inherit` unless the fill is opaque. */
  ink: string;
  /**
   * Colour for a slot *label* — the number printed on a swatch.
   *
   * Same idea as `ink` but never `inherit`: themes bake an alpha into their
   * own text colour (sage-green ships `rgba(64,90,92,0.92)`), and that muted
   * ink sitting on the faintest slot's own ink wash measured 4.24:1 — under
   * AA, and below the app's own 5.32:1 body text. Full strength fixes it
   * without touching how the mark itself renders.
   */
  label: string;
}

/**
 * Per-slot treatment for the invert preset. Slot 1 is full reverse video; the
 * rest stay unfilled or nearly so and are told apart by their underline, which
 * keeps a heavily annotated page from turning into a wall of solid blocks.
 */
const INVERT_TREATMENT: Record<HighlightSlot, Omit<HighlightSlotStyle, 'rgb' | 'ink' | 'label'>> = {
  '1': { alpha: '1', underlineWidth: '0', underlineStyle: 'solid' },
  '2': { alpha: '0', underlineWidth: '3px', underlineStyle: 'solid' },
  '3': { alpha: '0', underlineWidth: '3px', underlineStyle: 'dotted' },
  '4': { alpha: '0.18', underlineWidth: '1px', underlineStyle: 'solid' }
};

const asRgbList = (rgb: readonly [number, number, number]) => `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;

/** A colour string stripped of any alpha the theme baked in. */
const opaque = (color: string | undefined, fallback: string) => {
  const parsed = color ? parseColor(color) : null;
  return parsed ? `rgb(${asRgbList(parsed)})` : fallback;
};

/**
 * The CSS custom properties `app.scss` reads, for one theme + palette choice.
 *
 * Pure on purpose: the layout only has to mirror the result onto `:root`, and
 * the interesting part (which slot ends up readable on which theme) is testable
 * without a DOM.
 */
export function highlightSlotStyles(opts: {
  mode: HighlightPaletteMode;
  /** Hex per slot, used only by `custom`; short or malformed entries fall back. */
  custom?: readonly string[];
  /** Theme body-text colour — the ink the invert preset paints with. */
  fontColor?: string;
  /** Theme page background — what inverted text is set in. */
  backgroundColor?: string;
  /** Whether this theme's page is dark. Drives wash strength for the hue modes. */
  darkPage: boolean;
}): Record<HighlightSlot, HighlightSlotStyle> {
  const { mode, custom = [], fontColor, backgroundColor, darkPage } = opts;

  if (mode === 'invert') {
    // Falling back to the *other* end of the page keeps the pair legible even
    // if a custom theme omits one of the two colours.
    const ink = fontColor && parseColor(fontColor) ? fontColor : darkPage ? '#ffffff' : '#000000';
    const page =
      backgroundColor && parseColor(backgroundColor)
        ? backgroundColor
        : darkPage
          ? '#000000'
          : '#ffffff';
    const inkRgb = asRgbList(parseColor(ink) as [number, number, number]);
    return Object.fromEntries(
      HIGHLIGHT_SLOTS.map((slot) => [
        slot,
        {
          rgb: inkRgb,
          ...INVERT_TREATMENT[slot],
          // Only the opaque slot needs its text flipped; the others sit on the
          // untouched page and must keep the theme's own body colour.
          ink: INVERT_TREATMENT[slot].alpha === '1' ? page : 'inherit',
          label:
            INVERT_TREATMENT[slot].alpha === '1'
              ? opaque(page, darkPage ? '#000000' : '#ffffff')
              : opaque(ink, darkPage ? '#ffffff' : '#000000')
        }
      ])
    ) as Record<HighlightSlot, HighlightSlotStyle>;
  }

  // A bright wash under *light* body text is the problem: on the dark themes a
  // 0.5 wash drops text contrast from 7.2:1 to 1.6:1. Dark themes therefore get
  // a faint wash plus an underline to stay identifiable.
  const alpha = darkPage ? '0.12' : '0.5';
  const underlineWidth = darkPage ? '2px' : '0';
  return Object.fromEntries(
    HIGHLIGHT_SLOTS.map((slot, i) => {
      const picked = mode === 'custom' ? parseColor(custom[i] ?? '') : null;
      return [
        slot,
        {
          rgb: asRgbList(picked ?? HIGHLIGHT_SLOT_RGB[slot]),
          alpha,
          underlineWidth,
          underlineStyle: 'solid',
          ink: 'inherit',
          label: opaque(opts.fontColor, darkPage ? '#ffffff' : '#000000')
        }
      ];
    })
  ) as Record<HighlightSlot, HighlightSlotStyle>;
}

/** Default for the `custom` mode's picker — the historic hue palette as hex. */
export const DEFAULT_CUSTOM_COLORS = HIGHLIGHT_SLOTS.map((slot) => {
  const [r, g, b] = HIGHLIGHT_SLOT_RGB[slot];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
});

/**
 * Inline style for a slot swatch — menu chip, sidebar dot, notebook filter pill.
 *
 * A miniature of the mark itself rather than a fixed colour, so the swatch keeps
 * telling the truth when the palette is not hue-based: under `invert` all four
 * slots share one colour and are told apart by fill and ring exactly as they are
 * in the text.
 *
 * ponytail: the ring caps at 2px because the smallest consumers are 8-12px dots,
 * where a 3px dotted ring stops reading as dotted. If the slots ever need to be
 * unambiguous at that size, put the slot number on the swatch instead of
 * encoding the treatment.
 */
export function slotSwatchStyle(style: HighlightSlotStyle): string {
  const ring = style.underlineWidth === '0' ? '1px' : `min(2px, ${style.underlineWidth})`;
  return [
    `background: rgba(${style.rgb}, ${style.alpha})`,
    `border: ${ring} ${style.underlineStyle} rgb(${style.rgb})`
  ].join(';');
}
