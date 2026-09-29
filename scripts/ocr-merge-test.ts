import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors mergeOcrResult in pdf-ocr-runner.ts. The invariant it guards: a
 * whole-book OCR run takes minutes, and anything the user changed on that book
 * meanwhile must survive the write-back. The job used to put back the snapshot
 * it captured at start, reverting them.
 */
function mergeOcrResult<T extends Record<string, any>>(current: T, produced: T): T {
  return {
    ...current,
    elementHtml: produced.elementHtml,
    characters: produced.characters,
    sections: produced.sections,
    lastBookModified: produced.lastBookModified
  };
}

/** The row as it looked when the job started. */
const atJobStart = {
  id: 7,
  title: 'scan.pdf',
  ocrLang: 'ch',
  lastBookOpen: 1000,
  sourcePath: 'E:/e/scan',
  elementHtml: '<img data-pdf-page="1">',
  characters: 0,
  sections: [{ reference: 'a', charactersWeight: 0 }],
  lastBookModified: 1000
};

/** What runOcr produced — note it spreads the *stale* row. */
const produced = {
  ...atJobStart,
  elementHtml: '<div class="pdf-text-layer">识别出来的文字</div>',
  characters: 4200,
  sections: [{ reference: 'a', charactersWeight: 4200 }],
  lastBookModified: 2000
};

test('the OCR output itself lands', () => {
  const merged = mergeOcrResult(atJobStart, produced);
  assert.equal(merged.elementHtml, produced.elementHtml);
  assert.equal(merged.characters, 4200);
  assert.deepEqual(merged.sections, produced.sections);
  assert.equal(merged.lastBookModified, 2000);
});

test('a language change made during the run is not reverted', () => {
  // User realised the language was wrong and fixed it in the banner mid-run.
  const rowNow = { ...atJobStart, ocrLang: 'japan' };
  const merged = mergeOcrResult(rowNow, produced);
  assert.equal(merged.ocrLang, 'japan', 'the banner write must survive');
  assert.equal(merged.characters, 4200, 'and the OCR result must still land');
});

test('unrelated fields touched during the run survive too', () => {
  const rowNow = { ...atJobStart, lastBookOpen: 9999, sourcePath: 'E:/e/moved' };
  const merged = mergeOcrResult(rowNow, produced);
  assert.equal(merged.lastBookOpen, 9999);
  assert.equal(merged.sourcePath, 'E:/e/moved');
});

test('with no concurrent change the result is the plain OCR output', () => {
  const merged = mergeOcrResult(atJobStart, produced);
  assert.deepEqual(merged, produced);
});
