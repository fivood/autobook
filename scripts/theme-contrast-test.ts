/**
 * Every built-in theme must keep its derived text colours legible.
 *
 * A layout scan (impeccable detector over the rendered app) found secondary
 * text at 1.3–3.5:1 on every theme: it was the body colour faded with
 * opacity utilities, and the themes already bake an alpha into the body
 * colour. The derived colours below are what replaced that; this pins the
 * guarantee across all of them, including the theme with the least headroom
 * (sage-green's body text is 5.32:1 at full strength).
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contrastRatio,
  mutedText,
  readableOn,
  towardContrast
} from '../src/lib/data/format-color.ts';
import { availableThemes } from '../src/lib/data/theme-option.ts';

const themes = [...availableThemes.entries()] as [string, Record<string, string>][];

test('secondary text reads at 4.8:1 on every page and every menu', () => {
  for (const [name, t] of themes) {
    for (const [fg, bg, where] of [
      [t.fontColor, t.backgroundColor, 'page'],
      [t.menuFontColor, t.menuBackgroundColor, 'menu']
    ]) {
      const ratio = contrastRatio(mutedText(fg, bg), bg) ?? 0;
      assert.ok(ratio >= 4.79, `${name} ${where}: ${ratio.toFixed(2)}`);
    }
  }
});

test('secondary text is actually fainter where the theme can afford it', () => {
  const light = availableThemes.get('light-theme') as Record<string, string>;
  const ratio = contrastRatio(mutedText(light.fontColor, light.backgroundColor), light.backgroundColor) ?? 0;
  // Black on white is 16:1; muted should come down close to the floor, not
  // stay at body strength.
  assert.ok(ratio < 5.5, `light-theme muted is ${ratio.toFixed(2)}:1`);
});

test('the danger red reads on every page and every menu', () => {
  for (const [name, t] of themes) {
    for (const bg of [t.backgroundColor, t.menuBackgroundColor]) {
      const ratio = contrastRatio(towardContrast('#d95555', bg), bg) ?? 0;
      assert.ok(ratio >= 4.49, `${name} on ${bg}: ${ratio.toFixed(2)}`);
    }
  }
});

test('text on a selected button reads on every theme', () => {
  // Six themes put the light menu text on a mid-tone selected colour —
  // water and gray measured 2.3:1.
  for (const [name, t] of themes) {
    const text = readableOn(t.buttonSelectedColor, [t.menuFontColor, '#ffffff', '#111111']);
    const ratio = contrastRatio(text, t.buttonSelectedColor) ?? 0;
    assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}`);
  }
});

test('a colour that already passes is left alone', () => {
  assert.equal(towardContrast('#000000', '#ffffff'), 'rgb(0, 0, 0)');
  assert.equal(readableOn('#000000', ['#ffffff', '#111111']), '#ffffff');
});
