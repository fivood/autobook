import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keeps the three locale files honest.
 *
 * zh is the origin locale — en and ja fall back to it — so a key used in code
 * but absent from zh is what actually reaches the user, and it reaches them as
 * a mangled auto-title (`Settings.Item.$FontSize$`-looking text). That is not
 * hypothetical: a careless bulk rename produced exactly that in this codebase.
 *
 * Adding a string means touching three files, by hand, every time. This is the
 * check that notices when one of them was missed.
 */

const SRC = 'src';
const I18N = join(SRC, 'lib', 'i18n');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.svelte')) out.push(p);
  }
  return out;
}

function definedKeys(locale: string): Set<string> {
  const src = readFileSync(join(I18N, `${locale}.ts`), 'utf8');
  return new Set([...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

const zh = definedKeys('zh');
const en = definedKeys('en');
const ja = definedKeys('ja');

const sourceFiles = walk(SRC).filter((p) => !p.includes(join('lib', 'i18n')));

/** Keys named by a plain string literal at a $t/tImmediate call site. */
const usedKeys = new Set<string>();
/**
 * Keys named by the `labelKey` / `titleKey` sidecar pattern (see
 * merged-entries.ts): the identity travels as an untranslated field and only
 * the sidecar goes through $t at render time. Statically visible, so worth
 * checking even though the call site itself is dynamic.
 */
const sidecarKeys = new Set<string>();

for (const file of sourceFiles) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:\$t|tImmediate)\(\s*'([^']+)'/g)) {
    // Skip concatenations like `$t('locale.' + loc)` — the literal is a prefix,
    // not a key. They end in a dot precisely because something follows.
    if (!m[1].endsWith('.')) usedKeys.add(m[1]);
  }
  for (const m of src.matchAll(/(?:labelKey|titleKey):\s*'([^']+)'/g)) {
    sidecarKeys.add(m[1]);
  }
}

test('every key used in code exists in the origin locale', () => {
  const missing = [...usedKeys].filter((k) => !zh.has(k)).sort();
  assert.deepEqual(missing, [], `missing from zh.ts: ${missing.join(', ')}`);
});

test('every labelKey / titleKey sidecar resolves', () => {
  const missing = [...sidecarKeys].filter((k) => !zh.has(k)).sort();
  assert.deepEqual(missing, [], `sidecar keys missing from zh.ts: ${missing.join(', ')}`);
});

test('en carries exactly the same keys as zh', () => {
  const missing = [...zh].filter((k) => !en.has(k)).sort();
  const extra = [...en].filter((k) => !zh.has(k)).sort();
  assert.deepEqual(missing, [], `en.ts is missing: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `en.ts has keys zh.ts does not: ${extra.join(', ')}`);
});

test('ja carries exactly the same keys as zh', () => {
  const missing = [...zh].filter((k) => !ja.has(k)).sort();
  const extra = [...ja].filter((k) => !zh.has(k)).sort();
  assert.deepEqual(missing, [], `ja.ts is missing: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `ja.ts has keys zh.ts does not: ${extra.join(', ')}`);
});

test('the scan actually found the call sites it claims to check', () => {
  // A regex that silently stops matching would make every test above pass
  // vacuously, which is the failure mode this file most needs to avoid.
  assert.ok(usedKeys.size > 500, `only found ${usedKeys.size} used keys — the scan looks broken`);
  assert.ok(sidecarKeys.size > 20, `only found ${sidecarKeys.size} sidecar keys`);
  assert.ok(zh.size > 1000, `only found ${zh.size} keys in zh.ts`);
});
