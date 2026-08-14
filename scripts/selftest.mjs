/**
 * Dependency-light checks for the two pieces of logic where a silent
 * regression is worst: the book HTML sanitizer (a miss means arbitrary code
 * running with the app's filesystem access) and the AI spoiler cutoff (a miss
 * means the assistant quoting text the reader hasn't reached).
 *
 * Run with `npm test`. No test framework: the modules under test are pure, so
 * esbuild transpiles them in memory and Node imports the result.
 */

import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';

const scratch = mkdtempSync(join(tmpdir(), 'autobook-selftest-'));

/** Transpile a dependency-free TS module and import it. */
async function loadTs(path) {
  const source = readFileSync(path, 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const out = join(scratch, `${path.replace(/[^a-z0-9]/gi, '_')}.mjs`);
  writeFileSync(out, code);
  return import(pathToFileURL(out).href);
}

let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  if (!ok) failures++;
  // Detail is only interesting when something broke.
  results.push(`${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? `  — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- sanitizer

async function testSanitizer() {
  // The sanitizer is written against the DOM; give it one.
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.document = dom.window.document;

  const { sanitizeHtml } = await loadTs('src/lib/functions/sanitize-html.ts');

  // [input, probe, shouldSurvive]
  const cases = [
    ['<img src=x onerror="alert(1)">', /onerror/i, false],
    ['<img/onerror=alert(1) src=x>', /onerror/i, false],
    ['<a href="javascript:alert(1)">x</a>', /javascript:/i, false],
    ['<a href="java\tscript:alert(1)">x</a>', /script:/i, false],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', /script:/i, false],
    ['<iframe srcdoc="&lt;script&gt;"></iframe>', /iframe|srcdoc/i, false],
    ['<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>', /foreign|onerror/i, false],
    ['<div style="background:url(javascript:alert(1))">x</div>', /javascript/i, false],
    ['<body onload=alert(1)><p>hi</p>', /onload/i, false],
    ['<object data="evil.swf"></object>', /object/i, false],
    ['<form action="x"><input name=a></form>', /form|input/i, false],
    ['<meta http-equiv="refresh" content="0;url=x">', /http-equiv/i, false],
    ['<script>alert(1)</script><p>after</p>', /script/i, false],
    ['<svg><animate onbegin="alert(1)"/></svg>', /onbegin/i, false],
    // Ordinary book markup has to come through untouched.
    ['<p class="a">正文<em>强调</em></p>', /正文.*强调/, true],
    ['<img src="ttu:cover.jpg" alt="封面">', /ttu:cover\.jpg/, true],
    ['<img src="data:image/png;base64,AAAA">', /data:image/, true],
    ['<a href="chapter2.xhtml#top">下一章</a>', /chapter2/, true],
    ['<svg viewBox="0 0 1 1"><image xlink:href="ttu:p.jpg"/></svg>', /ttu:p\.jpg/, true],
    ['<ruby>漢<rt>かん</rt></ruby>', /<rt>/, true]
  ];

  for (const [input, probe, shouldSurvive] of cases) {
    const output = sanitizeHtml(input);
    const present = probe.test(output);
    check(
      `sanitize: ${input.slice(0, 46)}`,
      shouldSurvive ? present : !present,
      shouldSurvive ? `dropped: ${output.slice(0, 48)}` : `survived: ${output.slice(0, 48)}`
    );
  }
}

// ------------------------------------------------------------ spoiler cutoff

async function testSpoilerCutoff() {
  const { chunkBookText, clampChunkToCutoff } = await loadTs('src/lib/data/ai/bm25-index.ts');

  // Shaped like htmlToPlaintext output: a newline before AND after every block.
  const paragraphs = Array.from({ length: 40 }, (_, i) => `第${i}段` + '文'.repeat(300));
  const text = `\n${paragraphs.join('\n\n')}\n`;
  const chunks = chunkBookText(text);

  check('cutoff: chunks produced', chunks.length > 0, `${chunks.length}`);

  // Every chunk must sit where it says it does — the drift here is what let
  // unread chunks pass the cutoff test.
  const misplaced = chunks.find((chunk) => {
    const head = chunk.text.split('\n')[0];
    return text.slice(chunk.startChar, chunk.startChar + head.length) !== head;
  });
  check(
    'cutoff: startChar matches the real offset',
    !misplaced,
    misplaced ? `chunk ${misplaced.id} claims ${misplaced.startChar}` : ''
  );

  const last = chunks[chunks.length - 1];
  check('cutoff: last chunk stays in bounds', last.endChar <= text.length, `${last.endChar}/${text.length}`);

  const monster = chunkBookText('X'.repeat(9000));
  check('cutoff: an oversized paragraph is split', monster.length >= 7, `${monster.length} chunks`);
  check(
    'cutoff: no chunk exceeds the cap',
    monster.every((chunk) => chunk.text.length <= 1200),
    `max ${Math.max(...monster.map((chunk) => chunk.text.length))}`
  );

  const straddling = { id: 0, startChar: 100, endChar: 900, text: 'A'.repeat(800) };
  const clamped = clampChunkToCutoff(straddling, 500);
  check('cutoff: a straddling chunk is cut at the boundary', clamped?.text.length === 400, `${clamped?.text.length}`);
  check('cutoff: an unread chunk is dropped', clampChunkToCutoff(straddling, 100) === undefined);
  check('cutoff: a fully read chunk passes through', clampChunkToCutoff(straddling, 5000) === straddling);

  const boundary = 4000;
  const leaked = chunks
    .map((chunk) => clampChunkToCutoff(chunk, boundary))
    .filter(Boolean)
    .some((chunk) => chunk.startChar + chunk.text.length > boundary);
  check('cutoff: nothing survives past the reading position', !leaked);
}

await testSanitizer();
await testSpoilerCutoff();

console.log(results.join('\n'));
console.log(
  failures === 0
    ? `\n${results.length} checks passed`
    : `\n${failures} of ${results.length} checks FAILED`
);
process.exit(failures ? 1 : 0);
