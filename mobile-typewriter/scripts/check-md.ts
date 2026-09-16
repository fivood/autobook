// Self-check for the Markdown path and the mark decoder it extended.
// `npm test` bundles and runs it; a failed assertion exits non-zero.

import { strict as assert } from 'node:assert';
import { lexer } from 'marked';
import { mdToPlainText, mdTokensToText } from '../src/lib/load-md';
import { MARK_END, MARK_IMG, MARK_NOTE, MARK_SEP, decodeMarks, parseText } from '../src/lib/parse-text';

const md = (src: string) => parseText(mdTokensToText(lexer(src)));
const styled = (seg: { text: string; styles?: { kind: string; from: number; to: number }[] }) =>
  (seg.styles ?? []).map((r) => `${r.kind}:${seg.text.slice(r.from, r.to)}`);

// EPUB marks decode exactly as before the scanner replaced the regex.
{
  const line = `  ${MARK_IMG}cover.jpg${MARK_END}他说${MARK_NOTE}1${MARK_SEP}n1${MARK_END}。`;
  assert.deepEqual(decodeMarks(line), {
    text: '  他说。',
    marks: { images: ['cover.jpg'], notes: [{ at: 4, id: 'n1', n: '1' }] }
  });
  // An unterminated note stays in the text, as the old pattern left it.
  assert.equal(decodeMarks(`a${MARK_NOTE}1b`).text, `a${MARK_NOTE}1b`);
  assert.equal(decodeMarks(`a${MARK_NOTE}1b`).marks, undefined);
  assert.deepEqual(decodeMarks('plain'), { text: 'plain' });
}

// Headings: # and ## open chapters whatever their words, deeper ones don't;
// list text that looks like a chapter number stays a list item.
{
  const book = md('# 书名\n\n引言\n\n## Setup\n\n### 细节\n\n1. 一\n');
  assert.deepEqual(book.chapters.map((c) => c.title), ['书名', 'Setup']);
  assert.deepEqual(
    book.segments.map((s) => [s.type, s.block ?? '', s.text]),
    [
      ['h2', 'h1', '书名'],
      ['p', '', '引言'],
      ['h2', 'h2', 'Setup'],
      ['p', 'h3', '细节'],
      ['p', 'ol:1:1', '一']
    ]
  );
}

// Inline styles land on the right characters after trimming; only web links
// keep a target; entities decode; soft breaks join by script.
{
  const [p] = md('  **粗** and *it* `a &amp; b` ~~x~~ [w](https://e.com) [r](./x.md) &amp;\n').segments;
  assert.equal(p.text, '粗 and it a &amp; b x w r &');
  assert.deepEqual(styled(p), ['b:粗', 'i:it', 'code:a &amp; b', 's:x', 'a:w']);
  assert.equal(p.styles?.find((r) => r.kind === 'a')?.href, 'https://e.com');
  assert.equal(md('[x](javascript:alert(1))').segments[0].styles, undefined);

  assert.equal(md('第一行\n第二行').segments[0].text, '第一行第二行');
  assert.equal(md('one\n**two**').segments[0].text, 'one two');
  assert.deepEqual(md('line  \nbreak').segments.map((s) => s.text), ['line', 'break']);
}

// Lists, quotes, code, tables, rules.
{
  const book = md(
    [
      '- a',
      '  - b',
      '- [x] done',
      '',
      '> quoted',
      '',
      '```js',
      'if (x) {',
      '',
      '  y();',
      '}',
      '```',
      '',
      '| k | v |',
      '|---|---|',
      '| 1 | **2** |',
      '',
      '---',
      '',
      'after',
      '',
      '    solo'
    ].join('\n')
  );
  assert.deepEqual(
    book.segments.map((s) => [s.block ?? '', s.text]),
    [
      ['ul:1', 'a'],
      ['ul:2', 'b'],
      ['ul:1', '☑ done'],
      ['quote', 'quoted'],
      ['code:t', 'if (x) {'],
      ['code', ' '],
      ['code', '  y();'],
      ['code:e', '}'],
      ['thead', 'k │ v'],
      ['row', '1 │ 2'],
      ['', 'after'],
      ['code:te', 'solo']
    ]
  );
  assert.deepEqual(styled(book.segments[9]), ['sep: │ ', 'b:2']);
  assert.equal(book.segments[10].ruleBefore, true);
  // Marks cost nothing: offsets count only the typed characters.
  const typed = book.segments.reduce((n, s) => n + s.text.length, 0);
  assert.equal(book.totalChars, typed);
}

// Saved md books are keyed by the old plain conversion. Pin its output: if
// this changes, every saved Markdown book loses its place.
{
  const src = '---\ntitle: x\n---\n# 第一章 开始\n\n**hi** [a](b) `c`\n- item\n\n| p | q |\n|---|---|\n| 1 | 2 |\n';
  assert.equal(parseText(mdToPlainText(src)).flatText, '第一章 开始\nhi a c\nitem\np  q\n1  2');
}

console.log('check-md: ok');
