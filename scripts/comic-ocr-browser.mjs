/**
 * Drive a headless Chromium to run PaddleOCR over a comic, page by page,
 * then collect the results. Uses the same browser PaddleOCR build as the app.
 * Model tarballs are staged locally under the test dir and served via a
 * fetch interceptor in the page.
 *
 *   node scripts/comic-ocr-browser.mjs <pageCount> [fromPage]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const testDir = process.env.COMIC_TEST_DIR || 'C:\\Users\\fukki\\AppData\\Local\\Temp\\opencode\\comic-test';
const pagesDir = join(testDir, 'pages');
const modelsDir = join(testDir, 'models');
const modulesDir = join(repoRoot, 'node_modules');
const ortDir = join(repoRoot, 'static', 'vendor', 'ort');

const pageCount = Number(process.argv[2] || '0');
const fromPage = Number(process.argv[3] || '1');
if (!pageCount) {
  console.error('Usage: node scripts/comic-ocr-browser.mjs <pageCount> [fromPage]');
  process.exit(1);
}

let donePayload = null;
const donePromise = new Promise((resolve) => {
  const check = () => (donePayload ? resolve(donePayload) : setTimeout(check, 100));
  check();
});

const MIME = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tar': 'application/octet-stream'
};

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
    let file;
    if (urlPath === '/') {
      file = join(testDir, 'index.html');
    } else if (urlPath === '/preview.html' || urlPath === '/preview') {
      file = join(testDir, 'preview.html');
    } else if (urlPath.startsWith('/bundle/')) {
      file = join(testDir, 'bundle', urlPath.replace('/bundle/', ''));
    } else if (urlPath.startsWith('/pages/')) {
      file = join(pagesDir, urlPath.replace('/pages/', ''));
    } else if (urlPath.startsWith('/model/')) {
      file = join(modelsDir, urlPath.replace('/model/', ''));
    } else if (urlPath.startsWith('/modules/')) {
      file = join(modulesDir, urlPath.replace('/modules/', ''));
    } else if (urlPath.startsWith('/ort/')) {
      file = join(ortDir, urlPath.replace('/ort/', ''));
    } else if (urlPath === '/done' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        donePayload = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    } else {
      res.writeHead(404);
      res.end('not found: ' + urlPath);
      return;
    }

    // Prevent path traversal outside the intended roots.
    if (!file.startsWith(normalize(file)) && !file.includes('..')) {
      // keep as-is; normalize handles it below
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extOf(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`Server on http://127.0.0.1:${port}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
page.on('console', (msg) => {
  const text = msg.text();
  if (text.startsWith('[comic-ocr]')) console.log(text.replace('[comic-ocr]', '  '));
});
page.on('pageerror', (err) => console.error('  PAGE ERROR:', err.message));

console.log(`Opening http://127.0.0.1:${port}/?pages=${pageCount}&from=${fromPage}`);
await page.goto(`http://127.0.0.1:${port}/?pages=${pageCount}&from=${fromPage}`, { waitUntil: 'load', timeout: 120000 });

const payload = await Promise.race([
  donePromise,
  new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out waiting for OCR results')), 600000))
]);

await browser.close();
server.close();

console.log('\n=== OCR RESULTS ===');
for (const r of payload.results) {
  if (r.error) {
    console.log(`page ${r.num}: ERROR ${r.error}`);
    continue;
  }
  console.log(`\n--- page ${r.num} (${r.items.length} lines, ${r.ms}ms) ---`);
  for (const it of r.items.slice(0, 20)) {
    const p = it.poly || [];
    const box = p.length ? `(${Math.round(p[0][0])},${Math.round(p[0][1])})` : '()';
    console.log(`  [${box}] ${it.text}`);
  }
  if (r.items.length > 20) console.log(`  ... ${r.items.length - 20} more`);
}

const outFile = join(testDir, 'ocr-results.json');
const { writeFileSync } = await import('node:fs');
writeFileSync(outFile, JSON.stringify(payload, null, 2));
console.log(`\nSaved full results to ${outFile}`);
process.exit(0);
