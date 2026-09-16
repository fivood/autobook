import test from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors the clamp in settings-content.svelte's 空闲时间 field. */
const IDLE_MAX_MINUTES = 720;
function clampIdleMinutesToSeconds(minutes: number | null | undefined): number {
  if (!minutes || minutes < 0) return 0;
  if (minutes > IDLE_MAX_MINUTES) return IDLE_MAX_MINUTES * 60;
  return Math.floor(minutes * 60);
}

test('0 and blank keep idle detection off', () => {
  assert.equal(clampIdleMinutesToSeconds(0), 0);
  assert.equal(clampIdleMinutesToSeconds(null), 0);
  assert.equal(clampIdleMinutesToSeconds(-5), 0);
});

test('the default of five minutes round-trips', () => {
  assert.equal(clampIdleMinutesToSeconds(5), 300);
});

test('half-minute steps floor to whole seconds', () => {
  assert.equal(clampIdleMinutesToSeconds(2.5), 150);
});

test('the ceiling is the 12 hours the tooltip promises', () => {
  // The old code compared minutes against 43200 (the seconds in 12h), so this
  // sailed through unclamped, and anything it did clamp landed on 900s.
  assert.equal(clampIdleMinutesToSeconds(721), 43200);
  assert.equal(clampIdleMinutesToSeconds(50000), 43200);
  assert.equal(clampIdleMinutesToSeconds(720), 43200);
});
