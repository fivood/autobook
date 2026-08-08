/**
 * Verify the M2+M3 inpainting pipeline (flat-fill + LaMa sidecar) on a real
 * page: count flat-filled vs LaMa-handled bubbles, and confirm the result's
 * text regions are erased while gradient backgrounds survive.
 *   node scripts/comic-lama-verify.mjs [page]
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const testDir = process.env.COMIC_TEST_DIR || 'C:\\Users\\fukki\\AppData\\Local\\Temp\\opencode\\scoop-test';
const pagesDir = join(testDir, 'pages');
const pageNum = Number(process.argv[2] || '19');
const lamaEndpoint = 'http://127.0.0.1:8080';

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0] || '/');
    let file;
    if (urlPath === '/' || urlPath === '/verify.html') file = join(testDir, 'verify.html');
    else if (urlPath === '/ocr-results.json') file = join(testDir, 'ocr-results.json');
    else if (urlPath.startsWith('/pages/')) file = join(pagesDir, urlPath.replace('/pages/', ''));
    else if (urlPath.startsWith('/bundle/')) file = join(testDir, 'bundle', urlPath.replace('/bundle/', ''));
    else { res.writeHead(404); res.end('nf: ' + urlPath); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': urlPath.endsWith('.jpg') ? 'image/jpeg' : urlPath.endsWith('.json') ? 'application/json' : urlPath.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(data);
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
await page.goto(`http://127.0.0.1:${port}/verify.html?page=${pageNum}`, { waitUntil: 'load' });

const result = await page.evaluate(async (lama) => {
  const params = new URLSearchParams(location.search);
  const num = Number(params.get('page'));
  const { inpaintPageWithLama } = await import('/bundle/inpaint.js');
  const ocrData = await (await fetch('/ocr-results.json')).json();

  function bbox(poly) { let mX = Infinity, mY = Infinity, MX = -Infinity, MY = -Infinity; for (const [x, y] of poly) { if (x < mX) mX = x; if (y < mY) mY = y; if (x > MX) MX = x; if (y > MY) MY = y; } return [mX, mY, MX, MY]; }
  function vg(a, b) { return Math.max(a[1], b[1]) - Math.min(a[3], b[3]); }
  function hor(a, b) { const ow = Math.min(a[2], b[2]) - Math.max(a[0], b[0]); if (ow <= 0) return 0; const n = Math.min(a[2] - a[0], b[2] - b[0]); return n > 0 ? ow / n : 0; }
  function cen(p) { let cx = 0, cy = 0; for (const [x, y] of p) { cx += x; cy += y; } return [cx / p.length, cy / p.length]; }
  function group(items, pi, h) {
    if (!items.length) return [];
    const lh = h * 0.04, mg = lh * 1.5, mo = 0.35;
    const bx = items.map((i) => bbox(i.poly));
    const me = Array(items.length).fill(false);
    const gs = [];
    for (let i = 0; i < items.length; i++) {
      if (me[i]) continue;
      const g = [i]; me[i] = true; let ch = true;
      while (ch) { ch = false; for (let j = 0; j < items.length; j++) { if (me[j]) continue; for (const gi of g) { if (vg(bx[gi], bx[j]) < mg && hor(bx[gi], bx[j]) >= mo) { g.push(j); me[j] = true; ch = true; break; } } } }
      gs.push(g);
    }
    return gs.map((g, idx) => { const pts = g.flatMap((i) => items[i].poly); const b = bbox(pts); return { id: `p${pi}_b${idx}`, pageIndex: pi, poly: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] }; });
  }

  const key = String(num).padStart(3, '0');
  const pr = ocrData.results.find((r) => r.num === num);
  const bubbles = group(pr.items, num, 3282);
  const blob = await (await fetch(`/pages/page-${key}.jpg`)).blob();
  const t0 = performance.now();
  const { result, blob: outBlob } = await inpaintPageWithLama(blob, bubbles, lama);
  const ms = Math.round(performance.now() - t0);

  // Verify text erasure: sample each bubble's center region spread.
  const out = await createImageBitmap(outBlob);
  const c2 = document.createElement('canvas'); c2.width = out.width; c2.height = out.height; c2.getContext('2d').drawImage(out, 0, 0);
  const spread = (d) => { let s = 0, m = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) m += d[i]; m /= n; for (let i = 0; i < d.length; i += 4) s += (d[i] - m) ** 2; return Math.sqrt(s / n); };
  const regions = [];
  for (const b of bubbles) {
    const [[x0, y0], , [x1, y1]] = b.poly;
    const cx0 = Math.floor(x0 + (x1 - x0) * 0.3), cy0 = Math.floor(y0 + (y1 - y0) * 0.3);
    const cx1 = Math.ceil(x0 + (x1 - x0) * 0.7), cy1 = Math.ceil(y0 + (y1 - y0) * 0.7);
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    const px = c2.getContext('2d').getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0).data;
    regions.push({ w: Math.round(x1 - x0), h: Math.round(y1 - y0), spread: Math.round(spread(px)) });
  }
  return { totalBubbles: bubbles.length, inpainted: result.inpainted, skipped: result.skipped.length, ms, regions };
}, lamaEndpoint);

console.log(`page ${pageNum}: ${result.totalBubbles} bubbles → ${result.inpainted} handled (${result.skipped.length} still skipped) in ${result.ms}ms`);
let erased = 0;
for (const r of result.regions) {
  const clean = r.spread < 25;
  if (clean) erased++;
  console.log(`  ${String(r.w).padStart(4)}x${String(r.h).padStart(3)} spread=${String(r.spread).padStart(3)} ${clean ? '✓ 擦除' : '≈ 保留背景'}`);
}
console.log(`\n${erased}/${result.regions.length} regions clean (<25 spread)`);
await browser.close();
server.close();
process.exit(0);
