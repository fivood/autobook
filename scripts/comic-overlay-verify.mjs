/**
 * Verify overlay spans land on the rendered page image at expected positions,
 * for the v2 overlay (improved bubble grouping). Also reports font sizes.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const testDir = 'C:/Users/fukki/AppData/Local/Temp/opencode/comic-test';
const previewFile = process.argv[2] || 'preview-v2.html';

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (p === '/' || p === `/${previewFile}`) f = path.join(testDir, previewFile);
  else if (p.startsWith('/pages/')) f = path.join(testDir, 'pages', p.replace('/pages/', ''));
  else { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.jpg') ? 'image/jpeg' : 'text/html' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 60000 });

const totals = { ok: 0, out: 0, spans: 0 };
for (const num of [17, 19, 7]) {
  const result = await page.evaluate((n) => {
    const p = document.querySelector(`.page[data-page="${n}"]`);
    if (!p) return null;
    const img = p.querySelector('img');
    const box = img.getBoundingClientRect();
    const spans = [...p.querySelectorAll('.trans')];
    return {
      pageW: Math.round(box.width), pageH: Math.round(box.height),
      imgNaturalW: img.naturalWidth, imgNaturalH: img.naturalHeight,
      spanCount: spans.length,
      spans: spans.map((s) => {
        const r = s.getBoundingClientRect();
        return {
          text: (s.dataset.t || '').slice(0, 12),
          fs: s.style.fontSize,
          rect: { l: Math.round(r.left - box.left), t: Math.round(r.top - box.top), w: Math.round(r.width), h: Math.round(r.height) }
        };
      })
    };
  }, num);
  if (!result) continue;
  console.log(`\n=== page ${num}: ${result.spanCount} spans (img ${result.pageW}x${result.pageH}) ===`);
  for (const s of result.spans) {
    const inBounds = s.rect.l >= 0 && s.rect.t >= 0 && s.rect.l + s.rect.w <= result.pageW && s.rect.t + s.rect.h <= result.pageH;
    if (inBounds) totals.ok++; else totals.out++;
    totals.spans++;
    console.log(`  ${inBounds ? 'OK ' : 'OUT!'} fs=${s.fs} l=${s.rect.l} t=${s.rect.t} ${s.rect.w}x${s.rect.h} → ${s.text}`);
  }
}

console.log(`\nTOTAL: ${totals.spans} spans, ${totals.ok} in-bounds, ${totals.out} out-of-bounds`);
await browser.close();
server.close();
process.exit(0);
