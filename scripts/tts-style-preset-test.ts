/**
 * The reading-style dropdown swaps a tone prompt into the preset's request
 * body by dot-path. A typo in `stylePath` fails silently — the select shows
 * "custom", the body never changes — so guard that every declared path
 * actually resolves inside that preset's own template.
 *
 * Run via `npm test`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CUSTOM_PRESETS, TTS_STYLE_PRESETS } from '../src/lib/data/tts-presets.ts';

/** Same walk the settings UI does (navigateJson + setBodyValue). */
function at(root: unknown, path: string): unknown {
  let cur: any = root;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

const styled = Object.entries(CUSTOM_PRESETS).filter(([, p]) => p.stylePath);

test('some presets actually declare a style path', () => {
  assert.ok(styled.length >= 3, 'expected the prompt-capable presets to be tagged');
});

test('every stylePath resolves to the default prompt in its own body', () => {
  for (const [id, preset] of styled) {
    const value = at(JSON.parse(preset.body), preset.stylePath!);
    assert.equal(
      typeof value,
      'string',
      `${id}: stylePath "${preset.stylePath}" does not resolve in the body template`
    );
    assert.ok(
      TTS_STYLE_PRESETS.some((s) => s.value === value),
      `${id}: default prompt is not one of the offered styles, so the dropdown opens on "custom"`
    );
  }
});

test('style values are unique and non-empty', () => {
  const values = TTS_STYLE_PRESETS.map((s) => s.value);
  assert.equal(new Set(values).size, values.length, 'duplicate style prompts');
  assert.ok(values.every((v) => v.trim().length > 0));
});
