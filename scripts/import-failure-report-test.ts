import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors how importData turns per-file failures into the single string the
 * library page shows. The bug this guards: `errorMessage` used to be one
 * string that each failing file overwrote, so a batch import reported only
 * the last failure and the rest were invisible until you retried.
 */
const MAX_REPORTED_FAILURES = 10;

function reportFor(failures: string[]): string {
  const shown = failures.slice(0, MAX_REPORTED_FAILURES);
  if (failures.length > shown.length) {
    shown.push(`…还有 ${failures.length - shown.length} 个文件失败`);
  }
  return shown.join('\n');
}

test('no failures reports nothing, so the caller shows success', () => {
  assert.equal(reportFor([]), '');
});

test('a single failure reads exactly as before', () => {
  assert.equal(reportFor(['Error importing a.epub: broken']), 'Error importing a.epub: broken');
});

test('every failure in a batch survives, not just the last', () => {
  const out = reportFor([
    'Error importing a.epub: broken',
    'Error importing b.mobi: parser hung',
    'Error importing c.pdf: forbidden path'
  ]);
  assert.equal(out.split('\n').length, 3);
  for (const name of ['a.epub', 'b.mobi', 'c.pdf']) {
    assert.ok(out.includes(name), `${name} missing from the report`);
  }
});

test('a huge batch is capped but still states the true total', () => {
  const out = reportFor(Array.from({ length: 25 }, (_, i) => `Error importing ${i}.epub: nope`));
  const lines = out.split('\n');
  assert.equal(lines.length, MAX_REPORTED_FAILURES + 1);
  assert.ok(lines[lines.length - 1].includes('15'), 'should name the 15 it did not list');
});
