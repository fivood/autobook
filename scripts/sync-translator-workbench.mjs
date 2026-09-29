/**
 * Refresh the vendored `translator-workbench` package.
 *
 * Why a vendored tarball instead of a normal dependency: `fivood/transbook`
 * is a private repo, so every install-time fetch (git URL, submodule, GitHub
 * Packages) needs credentials on the CI runner. The release workflow is a
 * bare `actions/checkout` + `npm ci` with no secrets, and a PAT that silently
 * expires would break a release months later with no obvious cause. A packed
 * tarball is ~29 KB, resolves offline, and the lockfile pins its integrity
 * hash — `npm ci` reproduces it exactly with nothing to configure.
 *
 * The cost is that this is a snapshot: editing transbook no longer shows up
 * in the reader until this script is re-run. That is the trade, and it is why
 * the script also refreshes the lockfile — the tarball filename carries the
 * package version, so a change without a version bump would otherwise leave
 * the recorded integrity hash pointing at the previous contents and make
 * `npm ci` fail.
 *
 * Dev-only. CI never runs this; it consumes the committed tarball.
 *
 *   node scripts/sync-translator-workbench.mjs [path-to-transbook]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(repoRoot, 'vendor');
const source = resolve(process.argv[2] ?? join(repoRoot, '..', '..', 'translator-workbench'));

if (!existsSync(join(source, 'package.json'))) {
  console.error(`No package.json under ${source}`);
  console.error('Pass the transbook checkout path: node scripts/sync-translator-workbench.mjs <path>');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

console.info(`Building ${source}`);
run(npm, ['run', 'build'], source);

mkdirSync(vendorDir, { recursive: true });
for (const name of readdirSync(vendorDir)) {
  if (name.startsWith('translator-workbench-') && name.endsWith('.tgz')) {
    rmSync(join(vendorDir, name));
  }
}

// `npm pack` writes into cwd, so pack from the vendor dir with the source as
// the target rather than packing in place and moving the file afterwards.
console.info('Packing');
const packed = execFileSync(npm, ['pack', source, '--silent'], {
  cwd: vendorDir,
  encoding: 'utf8',
  shell: process.platform === 'win32'
})
  .trim()
  .split(/\r?\n/)
  .pop();

const tarball = join(vendorDir, packed);
if (!existsSync(tarball)) {
  console.error(`npm pack reported ${packed} but it is not in ${vendorDir}`);
  process.exit(1);
}

// Keep the dependency spec stable so package.json doesn't churn on every
// version bump; the lockfile is what pins the exact contents.
const stable = join(vendorDir, 'translator-workbench.tgz');
if (existsSync(stable)) rmSync(stable);
renameSync(tarball, stable);

console.info('Refreshing package-lock.json');
run(npm, ['install', '--package-lock-only', '--no-audit', '--no-fund'], repoRoot);

console.info(`\nDone: vendor/translator-workbench.tgz (packed from ${packed})`);
console.info('Commit vendor/translator-workbench.tgz together with package-lock.json.');
