// Postinstall: copy third-party runtime assets into static/vendor/ so
// they ship as plain files under their ORIGINAL names. Replaces the old
// inline `node -e` postinstall (libarchive + ort) and adds the pdfjs
// sidecar directories.
//
// Why pdfjs needs whole directories instead of Vite `?url` imports: the
// pdf.js worker resolves cmaps / standard fonts / wasm decoders as
// SIBLING files by original filename at runtime (e.g. jbig2.wasm,
// Adobe-GB1-UCS2.bcmap). A single `?url` import works in dev (URL
// points into node_modules) but breaks in production builds where Vite
// hashes the one imported file and the siblings don't exist at all —
// JBIG2-encoded scans then silently render blank. Same lesson as
// mobile-typewriter/scripts/copy-pdfjs-assets.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyFiles(srcDir, dstDir, files) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of files) {
    fs.copyFileSync(path.join(root, srcDir, f), path.join(dstDir, f));
  }
  console.log(`[vendor] ${srcDir} -> ${path.relative(root, dstDir)} (${files.length} files)`);
}

function copyDir(srcDir, dstDir) {
  const src = path.join(root, srcDir);
  fs.mkdirSync(dstDir, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    if (fs.statSync(s).isFile()) {
      fs.copyFileSync(s, path.join(dstDir, entry));
      n++;
    }
  }
  console.log(`[vendor] ${srcDir} -> ${path.relative(root, dstDir)} (${n} files)`);
}

copyFiles('node_modules/libarchive.js/dist', path.join(root, 'static/vendor/libarchive'), [
  'worker-bundle.js',
  'libarchive.wasm'
]);

copyFiles('node_modules/onnxruntime-web/dist', path.join(root, 'static/vendor/ort'), [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs'
]);

copyDir('node_modules/pdfjs-dist/cmaps', path.join(root, 'static/vendor/pdfjs/cmaps'));
copyDir('node_modules/pdfjs-dist/standard_fonts', path.join(root, 'static/vendor/pdfjs/standard_fonts'));
copyDir('node_modules/pdfjs-dist/wasm', path.join(root, 'static/vendor/pdfjs/wasm'));
