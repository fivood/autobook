/**
 * Screenshot original vs inpainted pages side by side.
 *   node scripts/comic-inpaint-visual.mjs [pages]
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
const pagesArg = process.argv[2] || '20';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg' };
function extOf(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); }

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
    let file;
    if (urlPath === '/' || urlPath === '/inpaint-visual.html') file = join(testDir, 'inpaint-visual.html');
    else if (urlPath === '/ocr-results.json') file = join(testDir, 'ocr-results.json');
    else if (urlPath.startsWith('/pages/')) file = join(pagesDir, urlPath.replace('/pages/', ''));
    else if (urlPath.startsWith('/bundle/')) file = join(testDir, 'bundle', urlPath.replace('/bundle/', ''));
    else { res.writeHead(404); res.end('nf: ' + urlPath); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extOf(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1900, height: 1400 } });
page.on('console', (msg) => { const t = msg.text(); if (t.startsWith('[inpaint]')) console.log(t.replace('[inpaint]', '  ')); });

await page.goto(`http://127.0.0.1:${port}/inpaint-visual.html?pages=${pagesArg}`, { waitUntil: 'load', timeout: 60000 });
// Wait for images to load
await page.waitForFunction(() => document.querySelectorAll('.panel img').length >= 2, { timeout: 60000 });
await page.waitForTimeout(1500);

const file = join(testDir, `inpaint-visual-${pagesArg.replace(',', '-')}.png`);
await page.screenshot({ path: file, fullPage: true });
console.log(`saved ${file}`);
await browser.close();
server.close();
process.exit(0);
