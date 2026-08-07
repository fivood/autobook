/**
 * Screenshot the comic translation preview to verify overlay alignment.
 *   node scripts/comic-preview-shot.mjs [pages...]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const testDir = 'C:\\Users\\fukki\\AppData\\Local\\Temp\\opencode\\comic-test';
const pagesDir = join(testDir, 'pages');
const targets = (process.argv[2] || '17,19').split(',').map(Number);

const MIME = { '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0] || '/');
    let file;
    if (p === '/preview.html' || p === '/') file = join(testDir, 'preview.html');
    else if (p.startsWith('/pages/')) file = join(pagesDir, p.replace('/pages/', ''));
    else { res.writeHead(404); res.end('nf'); return; }
    const data = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
await page.goto(`http://127.0.0.1:${port}/preview.html`, { waitUntil: 'networkidle', timeout: 60000 });

for (const num of targets) {
  const el = page.locator(`.page[data-page="${num}"]`);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const file = join(testDir, `shot-page-${num}.png`);
  await el.screenshot({ path: file });
  console.log(`saved ${file}`);
}
await browser.close();
server.close();
process.exit(0);
