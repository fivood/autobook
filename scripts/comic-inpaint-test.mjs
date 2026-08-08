/**
 * Run the inpainting algorithm over comic pages in a headless browser and
 * report how many bubbles get filled vs skipped.
 *   node scripts/comic-inpaint-test.mjs <pageCount> [fromPage]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const testDir = process.env.COMIC_TEST_DIR || 'C:\\Users\\fukki\\AppData\\Local\\Temp\\opencode\\scoop-test';
const pagesDir = join(testDir, 'pages');

const pageCount = Number(process.argv[2] || '5');
const fromPage = Number(process.argv[3] || '19');

let donePayload = null;
const donePromise = new Promise((resolve) => {
  const check = () => (donePayload ? resolve(donePayload) : setTimeout(check, 100));
  check();
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg' };
function extOf(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); }

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
    let file;
    if (urlPath === '/' || urlPath === '/inpaint.html') file = join(testDir, 'inpaint.html');
    else if (urlPath === '/ocr-results.json') file = join(testDir, 'ocr-results.json');
    else if (urlPath.startsWith('/pages/')) file = join(pagesDir, urlPath.replace('/pages/', ''));
    else if (urlPath.startsWith('/bundle/')) file = join(testDir, 'bundle', urlPath.replace('/bundle/', ''));
    else if (urlPath === '/done' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { donePayload = JSON.parse(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
      return;
    } else { res.writeHead(404); res.end('nf: ' + urlPath); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extOf(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
page.on('console', (msg) => { const t = msg.text(); if (t.startsWith('[inpaint]')) console.log(t.replace('[inpaint]', '  ')); });
page.on('pageerror', (e) => console.error('  PAGE ERROR:', e.message));

await page.goto(`http://127.0.0.1:${port}/inpaint.html?pages=${pageCount}&from=${fromPage}`, { waitUntil: 'load', timeout: 60000 });
const payload = await Promise.race([
  donePromise,
  new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out')), 300000))
]);
await browser.close();
server.close();

console.log('\n=== INPAINT SUMMARY ===');
let totalBubbles = 0, totalInpainted = 0, totalSkipped = 0;
for (const r of payload.results) {
  totalBubbles += r.totalBubbles; totalInpainted += r.inpainted; totalSkipped += r.skipped;
  console.log(`page ${r.num}: ${r.totalBubbles} bubbles → ${r.inpainted} inpainted, ${r.skipped} skipped`);
}
console.log(`\nTOTAL: ${totalBubbles} bubbles, ${totalInpainted} inpainted (${Math.round(totalInpainted / Math.max(1, totalBubbles) * 100)}%), ${totalSkipped} skipped`);
process.exit(0);
