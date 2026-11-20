import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexBookFiles,
  renameRepeatedIds,
  resolveBookHref
} from '../src/lib/functions/file-loaders/epub/book-links.ts';

const files = [
  { href: 'Text/ch1.xhtml', wrapperId: 'ttu-c1' },
  { href: 'Text/ch2.xhtml', wrapperId: 'ttu-c2' },
  { href: 'Text/注释.xhtml', wrapperId: 'ttu-n' }
];
// Every chapter numbers its notes from n1.
const renamed = renameRepeatedIds([['n1', 'x'], ['n1', 'y'], ['n1', '注1']]);
const byHref = indexBookFiles(files);
const resolve = (href: string, from: number) => resolveBookHref(href, from, files, byHref, renamed);

test('repeated ids are renamed in every file after the first', () => {
  assert.deepEqual(
    renamed.map((m) => [...m]),
    [[], [['n1', 'n1--1']], [['n1', 'n1--2']]]
  );
});

test('a link lands on the copy in the file it names', () => {
  assert.equal(resolve('#n1', 1), '#n1--1');
  assert.equal(resolve('ch1.xhtml#n1', 1), '#n1');
  assert.equal(resolve('../Text/ch2.xhtml#n1', 0), '#n1--1');
  assert.equal(resolve('%E6%B3%A8%E9%87%8A.xhtml#%E6%B3%A81', 0), '#注1');
  assert.equal(resolve('ch2.xhtml#y', 0), '#y');
});

test('a link to a whole file goes to that chapter', () => {
  assert.equal(resolve('ch2.xhtml', 0), '#ttu-c2');
  assert.equal(resolve('./ch2.xhtml#', 0), '#ttu-c2');
});

test('external, unknown and bare links keep the old flattening', () => {
  assert.equal(resolve('https://example.com/a#b', 0), '#b');
  assert.equal(resolve('missing.xhtml#z', 0), '#z');
  assert.equal(resolve('#', 0), '#');
});
