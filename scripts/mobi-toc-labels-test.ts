import test from 'node:test';
import assert from 'node:assert/strict';
import { tocLabels } from '../src/lib/functions/file-loaders/mobi/mobi-toc-labels.ts';

// Shape of a Calibre MOBI6: chapters titled by bare numbers, a notes section
// whose back-links (whole note text) point at references, and the contents
// page last.
const chapter = (n: number, ref = '') =>
  `<p><a id="filepos${n}00"></a><b>${n}</b></p><p>${ref}正文${'字'.repeat(40)}</p>`;
const parts = [
  chapter(1, '近开头<a id="filepos150"></a><a href="#filepos900">1</a>'),
  chapter(2),
  chapter(3),
  '<p>注释</p><p><a id="filepos900"></a><a href="#filepos150">牧羊人派：英国传统主食。</a></p>',
  '<p>目录</p><ul><li><a href="#filepos100">1</a></li><li><a href="#filepos200">2</a></li><li><a href="#filepos300">第三章 <b>结局</b></a></li></ul>'
];

test('the contents page names the sections its links open', () => {
  assert.deepEqual([...tocLabels(parts)], [
    [0, '1'],
    [1, '2'],
    [2, '第三章 结局']
  ]);
});

test('note back-links never become titles', () => {
  const labels = tocLabels(parts);
  assert.ok(![...labels.values()].some((l) => l.includes('牧羊人派')));
});

test('no contents page, no titles', () => {
  assert.equal(tocLabels(parts.slice(0, 4)).size, 0);
});
