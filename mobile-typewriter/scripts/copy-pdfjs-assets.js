#!/usr/bin/env node
/**
 * Mirror pdfjs-dist's three sidecar asset directories into
 * `static/vendor/pdfjs/` so the worker can fetch them at runtime via
 * predictable URLs.
 *
 * Why: pdfjs-dist ships ~190 small files across cmaps + standard_fonts
 * + wasm. The worker resolves them by directory URL — when CJK glyphs
 * need a specific Adobe-GB1 cmap, or a non-Latin standard font, or
 * JBIG2 image decompression, it builds the URL by stem and fetches.
 * If we only Vite-bundle the ones we explicitly `?url`-import, every
 * other lookup misses and the SPA fallback returns index.html with a
 * `text/html` MIME, which the browser's strict module-script rule
 * rejects with "Failed to load module script: ..." — and the page
 * silently renders blank.
 *
 * Copying as plain static assets sidesteps Vite's bundler entirely.
 * The files end up in the dev server's static root AND the production
 * build output. Cloudflare Pages serves them with `application/wasm` /
 * `text/javascript` / `application/octet-stream` based on extension.
 */

import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const src = resolve(projectRoot, 'node_modules', 'pdfjs-dist');
const dst = resolve(projectRoot, 'static', 'vendor', 'pdfjs');

const dirs = ['cmaps', 'standard_fonts', 'wasm'];

mkdirSync(dst, { recursive: true });

for (const d of dirs) {
  const srcDir = join(src, d);
  const dstDir = join(dst, d);
  try {
    statSync(srcDir);
  } catch {
    console.warn(`[pdfjs] source missing, skipped: ${srcDir}`);
    continue;
  }
  mkdirSync(dstDir, { recursive: true });
  cpSync(srcDir, dstDir, { recursive: true });
  const count = readdirSync(dstDir).length;
  console.log(`[pdfjs] copied ${d}: ${count} files`);
}
