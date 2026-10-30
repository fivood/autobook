import test from 'node:test';
import assert from 'node:assert/strict';
import parseCss from '../src/lib/functions/css-parser/css-parser.ts';
import stringifyCss from '../src/lib/functions/css-parser/css-stringify.ts';

/**
 * This parser eats publisher CSS — third-party input nobody here controls —
 * and it throws on everything it does not understand. It runs inside the
 * observable that loads a book, so before format-style-sheet grew a fallback
 * a single unterminated comment produced a completely blank page: no error,
 * no message, nothing to act on. Verified on real hardware.
 *
 * Two layers now stand between that input and a blank book. This file covers
 * the lower one: block at-rules the parser does not model individually no
 * longer throw, so a book using them keeps the rest of its styling instead of
 * falling all the way through to the catch-all. (The catch-all itself lives
 * in format-style-sheet.ts, which pulls in the `$lib` graph and so is checked
 * on real hardware rather than here.)
 */

const throwsOn = (css: string) => {
  try {
    parseCss(css);
    return false;
  } catch {
    return true;
  }
};

test('block at-rules the parser does not model are parsed, not rejected', () => {
  // Each of these used to fall through to rule() and die on
  // "property missing ':'", discarding the entire stylesheet.
  for (const css of [
    '@layer base { p { color: red } }',
    '@container (min-width: 10px) { p { color: red } }',
    '@scope (.a) { p { color: red } }',
    '@unknown whatever { p { color: red } }'
  ]) {
    assert.equal(throwsOn(css), false, css);
  }
});

test('rules after an unmodelled at-rule block survive it', () => {
  const tree = parseCss('@layer base { p { color: red } } .after { margin: 1px }');
  const selectors = tree.stylesheet.rules
    .filter((r: { type: string }) => r.type === 'rule')
    .flatMap((r: { selectors: string[] }) => r.selectors);
  assert.deepEqual(selectors, ['.after']);
});

test('an unmodelled at-rule can be stringified without blowing up', () => {
  // visit() calls renderMethods[node.type] unguarded, so a node type with no
  // render method is a TypeError rather than a silent skip.
  const tree = parseCss('@layer base { p { color: red } }');
  assert.doesNotThrow(() => stringifyCss(tree));
  assert.match(stringifyCss(tree), /@layer base\{/);
});

test('the at-rule fallback does not swallow ordinary rules', () => {
  const tree = parseCss('p { color: red } .x { margin: 1px }');
  assert.equal(tree.stylesheet.rules.length, 2);
});

test('semicolon at-rules keep their own handling', () => {
  // The fallback only claims at-rules with a block; @import / @charset /
  // @namespace end in a semicolon and must not be captured by it.
  const tree = parseCss('@import url("a.css"); @charset "utf-8"; p { color: red }');
  const types = tree.stylesheet.rules.map((r: { type: string }) => r.type);
  assert.ok(types.includes('import'), `expected an import node, got ${types.join(',')}`);
});

test('the malformed input that reaches the fallback still throws here', () => {
  // Not a defect — it is why format-style-sheet needs its catch. Pinned so
  // that if the parser ever becomes tolerant, the reason for the fallback is
  // re-examined rather than quietly outliving its purpose.
  assert.equal(throwsOn('p { color: red } /* oops'), true, 'unterminated comment');
  assert.equal(throwsOn('p { color: red;'), true, 'missing closing brace');
  assert.equal(throwsOn('p { color: red } }'), true, 'extra closing brace');
});
