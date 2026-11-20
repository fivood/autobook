import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enterEdit,
  indentEdit,
  wrapEdit,
  type TextEdit
} from '../src/lib/components/text-editor/markdown-keys.ts';

/** Apply an edit the way the textarea would, returning text with `|` at the caret. */
function apply(text: string, e: TextEdit | null): string | null {
  if (!e) return null;
  const out = text.slice(0, e.start) + e.insert + text.slice(e.end);
  return e.selStart === e.selEnd
    ? out.slice(0, e.selStart) + '|' + out.slice(e.selStart)
    : out.slice(0, e.selStart) + '[' + out.slice(e.selStart, e.selEnd) + ']' + out.slice(e.selEnd);
}

/** `|` marks a collapsed caret, `[..]` a selection. */
function run(src: string, fn: (t: string, s: number, e: number) => TextEdit | null) {
  const caret = src.indexOf('|');
  if (caret >= 0) {
    const t = src.replace('|', '');
    return apply(t, fn(t, caret, caret));
  }
  const s = src.indexOf('[');
  const t = src.replace('[', '').replace(']', '');
  const e = src.indexOf(']') - 1;
  return apply(t, fn(t, s, e));
}

test('Enter continues bullets, numbers, tasks and quotes', () => {
  assert.equal(run('- a|', enterEdit), '- a\n- |');
  assert.equal(run('  * a|', enterEdit), '  * a\n  * |');
  assert.equal(run('9. a|', enterEdit), '9. a\n10. |');
  assert.equal(run('1) a|', enterEdit), '1) a\n2) |');
  assert.equal(run('- [x] done|', enterEdit), '- [x] done\n- [ ] |');
  assert.equal(run('> q|', enterEdit), '> q\n> |');
});

test('Enter on an empty item ends the list', () => {
  assert.equal(run('- a\n- |', enterEdit), '- a\n|');
  assert.equal(run('- a\n- [ ] |', enterEdit), '- a\n|');
});

test('Enter elsewhere is left to the browser', () => {
  assert.equal(run('plain|', enterEdit), null);
  assert.equal(run('-|- a', enterEdit), null, 'caret inside the marker');
  assert.equal(run('-dash|', enterEdit), null, 'not a list marker');
});

test('Enter mid-item splits it with a new marker', () => {
  assert.equal(run('- ab|cd', enterEdit), '- ab\n- |cd');
});

test('Tab types an indent in text, shifts list lines', () => {
  assert.equal(run('ab|c', (t, s, e) => indentEdit(t, s, e, false)), 'ab  |c');
  assert.equal(run('- a|', (t, s, e) => indentEdit(t, s, e, false)), '  - a|');
  assert.equal(
    run('[a\nb]\nc', (t, s, e) => indentEdit(t, s, e, false)),
    '  [a\n  b]\nc'
  );
});

test('Shift+Tab outdents, and does nothing at column 0', () => {
  assert.equal(run('    - a|', (t, s, e) => indentEdit(t, s, e, true)), '  - a|');
  assert.equal(run('[  a\nb]', (t, s, e) => indentEdit(t, s, e, true)), '[a\nb]');
  assert.equal(run('a|', (t, s, e) => indentEdit(t, s, e, true)), null);
});

test('a selection ending at a line start does not pull in that line', () => {
  assert.equal(run('[a\n]b', (t, s, e) => indentEdit(t, s, e, false)), '  [a\n]b');
});

test('wrap surrounds the selection or leaves the caret between markers', () => {
  assert.equal(run('x[bold]y', (t, s, e) => wrapEdit(t, s, e, '**')), 'x**[bold]**y');
  assert.equal(run('x|y', (t, s, e) => wrapEdit(t, s, e, '*')), 'x*|*y');
});
