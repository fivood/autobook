/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Pixel threshold below which an image is treated as an inline glyph
 * (footnote marker, 圈点, single-character image, decorative bullet) rather
 * than an illustration. Such images shouldn't be hidden as spoilers nor
 * count as full illustrations for character-counting purposes. */
const INLINE_GLYPH_PX_THRESHOLD = 40;

function parsePxDimension(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Bare number → px
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  // With px / em / ex / rem / lh — em-ish units typically mean "line height
  // sized", which is always small enough to be a glyph (≤ a few em).
  const m = trimmed.match(/^(\d+(?:\.\d+)?)\s*(px|em|ex|rem|lh)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'px') return n;
  // 1 em ~ 16px in default browser. We multiply by 16 to compare against the
  // px threshold; ≤ 2.5em is "small enough to be a glyph" by this rule.
  return n * 16;
}

function readDimension(el: HTMLImageElement, attr: 'width' | 'height'): number | null {
  const fromAttr = parsePxDimension(el.getAttribute(attr));
  if (fromAttr !== null) return fromAttr;
  const style = el.getAttribute('style') || '';
  const m = style.match(new RegExp(`${attr}\\s*:\\s*([^;]+)`, 'i'));
  if (m) return parsePxDimension(m[1]);
  return null;
}

/** An image is treated as an inline glyph (gaiji-equivalent) when it either
 * carries the `gaiji` class (upstream convention) OR its declared width and
 * height both fit within an inline run. */
export function isElementGaiji(el: HTMLImageElement) {
  const classList = Array.from(el.classList);
  if (classList.some((c) => /gaiji|footnote|note|icon|inline/i.test(c))) {
    return true;
  }
  if (el.closest('sup, sub, ruby')) {
    return true;
  }
  const alt = (el.getAttribute('alt') || '').toLowerCase();
  if (/^(note|注|footnote|marker)$/i.test(alt)) {
    return true;
  }
  const w = readDimension(el, 'width');
  const h = readDimension(el, 'height');
  if (w !== null && h !== null && w <= INLINE_GLYPH_PX_THRESHOLD && h <= INLINE_GLYPH_PX_THRESHOLD) {
    return true;
  }
  return false;
}
