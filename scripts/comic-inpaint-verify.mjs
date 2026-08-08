/**
 * Verify inpainting actually erases text: compare color spread in each
 * bubble's center region between original and inpainted page.
 *   node scripts/comic-inpaint-verify.mjs [page]
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
const pageNum = Number(process.argv[2] || '20');

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
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
await page.goto(`http://127.0.0.1:${port}/verify.html?page=${pageNum}`, { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const params = new URLSearchParams(location.search);
  const num = Number(params.get('page'));
  const { inpaintPage } = await import('/bundle/inpaint.js');
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
    return gs.map((g, idx) => { const pts = g.flatMap((i) => items[i].poly); const b = bbox(pts); return { poly: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] }; });
  }

  const key = String(num).padStart(3, '0');
  const pr = ocrData.results.find((r) => r.num === num);
  const bubbles = group(pr.items, num, 3282);
  const blob = await (await fetch(`/pages/page-${key}.jpg`)).blob();

  const orig = await createImageBitmap(blob);
  const c1 = document.createElement('canvas'); c1.width = orig.width; c1.height = orig.height; c1.getContext('2d').drawImage(orig, 0, 0);
  const { result } = await inpaintPage(blob, bubbles);
  const ctx2 = c1.getContext('2d'); // reuse same canvas? no — need inpainted. Re-fetch.
  const blob2 = await (await fetch(`/pages/page-${key}.jpg`)).blob();
  const { blob: outBlob } = await inpaintPage(blob2, bubbles);
  const out = await createImageBitmap(outBlob);
  const c2 = document.createElement('canvas'); c2.width = out.width; c2.height = out.height; c2.getContext('2d').drawImage(out, 0, 0);

  const spread = (d) => { let s = 0, m = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) m += d[i]; m /= n; for (let i = 0; i < d.length; i += 4) s += (d[i] - m) ** 2; return Math.sqrt(s / n); };
  const out2 = [];
  for (const b of bubbles) {
    const [[x0, y0], , [x1, y1]] = b.poly;
    const cx0 = Math.floor(x0 + (x1 - x0) * 0.3), cy0 = Math.floor(y0 + (y1 - y0) * 0.3);
    const cx1 = Math.ceil(x0 + (x1 - x0) * 0.7), cy1 = Math.ceil(y0 + (y1 - y0) * 0.7);
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    const a = c1.getContext('2d').getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0).data;
    const b2 = c2.getContext('2d').getImageData(cx0, cy0, cx1 - cx0, cy1 - cy0).data;
    out2.push({ w: Math.round(x1 - x0), h: Math.round(y1 - y0), origSpread: Math.round(spread(a)), inpaintSpread: Math.round(spread(b2)) });
  }
  return { inpainted: result.inpainted, skipped: result.skipped.length, bubbles: out2 };
});

console.log(`page ${pageNum}: ${result.inpainted} inpainted, ${result.skipped} skipped`);
console.log('气泡中心区域颜色扩散（原→抹字）：');
let erased = 0;
for (const b of result.bubbles) {
  const clean = b.inpaintSpread < 25;
  if (clean) erased++;
  console.log(`  ${String(b.w).padStart(4)}x${String(b.h).padStart(3)} orig=${String(b.origSpread).padStart(3)} → inpaint=${String(b.inpaintSpread).padStart(3)} ${clean ? '✓ 纯色(擦除)' : b.inpaintSpread < b.origSpread ? '↓ 下降' : '? 未擦净'}`);
}
console.log(`\n${erased}/${result.bubbles.length} bubbles fully erased (spread<25)`);
await browser.close();
server.close();
process.exit(0);
