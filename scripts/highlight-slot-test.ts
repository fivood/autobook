/**
 * Highlight slot normalization.
 *
 * Highlights stored their slot as a colour name until db v13. The v12→v13
 * migration rewrites local rows, but `highlights_*.json` backups from an older
 * device can be imported at any time — and a slot that doesn't normalize lands
 * as `mark.hl-undefined`, which matches no rule and falls back to the browser's
 * default full-opacity yellow: it ignores the theme entirely and drops text
 * contrast to ~1.6:1 on the dark themes. So the mapping and the fallback are
 * what this guards.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CUSTOM_COLORS,
  HIGHLIGHT_SLOTS,
  HIGHLIGHT_SLOT_CHIP,
  HIGHLIGHT_SLOT_DOT,
  HIGHLIGHT_SLOT_RGB,
  LEGACY_SLOT_OF_COLOR,
  highlightSlotStyles,
  normalizeHighlightSlot
} from '../src/lib/data/highlight-color.ts';

test('pre-v13 colour names keep their display order', () => {
  // The migration relies on this order: slot N must be what colour N used to
  // be, or every existing highlight silently changes appearance.
  assert.deepEqual(
    ['yellow', 'blue', 'green', 'pink'].map((c) => LEGACY_SLOT_OF_COLOR[c]),
    ['1', '2', '3', '4']
  );
});

test('normalize accepts both spellings', () => {
  assert.equal(normalizeHighlightSlot('green'), '3');
  assert.equal(normalizeHighlightSlot('3'), '3');
});

test('normalize never returns something without a mark rule', () => {
  for (const junk of [undefined, null, '', 'purple', '0', '5', 42, {}]) {
    assert.ok(
      HIGHLIGHT_SLOTS.includes(normalizeHighlightSlot(junk)),
      `${String(junk)} escaped normalization`
    );
  }
});

test('every slot has a full set of surfaces', () => {
  for (const slot of HIGHLIGHT_SLOTS) {
    assert.equal(HIGHLIGHT_SLOT_RGB[slot]?.length, 3, `slot ${slot} rgb`);
    assert.match(HIGHLIGHT_SLOT_CHIP[slot], /^rgba\(/, `slot ${slot} chip`);
    assert.match(HIGHLIGHT_SLOT_DOT[slot], /^rgba\(/, `slot ${slot} dot`);
  }
  assert.equal(Object.keys(HIGHLIGHT_SLOT_RGB).length, HIGHLIGHT_SLOTS.length);
});

const DARK = { fontColor: '#e8e8e8', backgroundColor: '#1a1a1a', darkPage: true };
const LIGHT = { fontColor: '#405a5c', backgroundColor: '#f0efe6', darkPage: false };

test('colour mode is unchanged by the slot rename', () => {
  const light = highlightSlotStyles({ mode: 'color', ...LIGHT });
  assert.equal(light['1'].rgb, '255, 235, 59');
  assert.equal(light['1'].alpha, '0.5');
  assert.equal(light['1'].ink, 'inherit');

  // Dark pages take the faint wash plus a visible underline. The underline
  // being *visible* is the point: it used to be reset to transparent by the
  // shared `mark[data-hl-id]` shorthand, leaving dark themes with a 0.12 wash
  // and nothing else.
  const dark = highlightSlotStyles({ mode: 'color', ...DARK });
  assert.equal(dark['1'].alpha, '0.12');
  assert.equal(dark['1'].underlineWidth, '2px');
});

test('invert mode carries no hue at all', () => {
  for (const theme of [LIGHT, DARK]) {
    const styles = highlightSlotStyles({ mode: 'invert', ...theme });
    const hues = new Set(HIGHLIGHT_SLOTS.map((s) => styles[s].rgb));
    assert.equal(hues.size, 1, 'slots must not differ by colour');
    assert.equal([...hues][0], theme === LIGHT ? '64, 90, 92' : '232, 232, 232');
  }
});

test('invert mode still separates all four slots', () => {
  const styles = highlightSlotStyles({ mode: 'invert', ...DARK });
  const looks = HIGHLIGHT_SLOTS.map(
    (s) => `${styles[s].alpha}|${styles[s].underlineWidth}|${styles[s].underlineStyle}`
  );
  assert.equal(new Set(looks).size, 4, `slots collapsed: ${looks.join(' ')}`);
});

test('only an opaque fill flips its text colour', () => {
  const styles = highlightSlotStyles({ mode: 'invert', ...DARK });
  for (const slot of HIGHLIGHT_SLOTS) {
    const opaque = styles[slot].alpha === '1';
    assert.equal(
      styles[slot].ink,
      opaque ? DARK.backgroundColor : 'inherit',
      `slot ${slot} ink`
    );
  }
});

test('invert survives a theme that declares no colours', () => {
  const styles = highlightSlotStyles({ mode: 'invert', darkPage: true });
  assert.equal(styles['1'].rgb, '255, 255, 255');
  assert.equal(styles['1'].ink, '#000000');
});

test('custom colours fall back per slot, not all-or-nothing', () => {
  const styles = highlightSlotStyles({
    mode: 'custom',
    custom: ['#ff0000', 'not-a-colour', '', '#0000ff'],
    ...LIGHT
  });
  assert.equal(styles['1'].rgb, '255, 0, 0');
  assert.equal(styles['4'].rgb, '0, 0, 255');
  // Slots 2 and 3 keep the built-in palette rather than disappearing.
  assert.equal(styles['2'].rgb, '100, 181, 246');
  assert.equal(styles['3'].rgb, '129, 199, 132');
});

test('the custom picker defaults to exactly the colour palette', () => {
  const custom = highlightSlotStyles({ mode: 'custom', custom: DEFAULT_CUSTOM_COLORS, ...LIGHT });
  const builtin = highlightSlotStyles({ mode: 'color', ...LIGHT });
  assert.deepEqual(custom, builtin);
});
