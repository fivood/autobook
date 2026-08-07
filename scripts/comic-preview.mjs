/**
 * Generate an HTML preview that overlays translated text on each comic page.
 * Positioning is done at runtime in the browser using each image's natural
 * width, so poly coordinates map exactly onto the rendered artwork.
 *
 *   node scripts/comic-preview.mjs <overlay.json> <out.html> [pagesDir]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , overlayFile, outHtml, pagesDirArg] = process.argv;
if (!overlayFile || !outHtml) {
  console.error('Usage: node scripts/comic-preview.mjs <overlay.json> <out.html> [pagesDir]');
  process.exit(1);
}
const pagesDir = pagesDirArg || 'C:/Users/fukki/AppData/Local/Temp/opencode/comic-test/pages';
const data = JSON.parse(readFileSync(overlayFile, 'utf8'));

const pageNums = [...new Set(data.bubbles.map((b) => b.pageIndex))].sort((a, b) => a - b);
const bubblesByPage = {};
for (const b of data.bubbles) {
  (bubblesByPage[b.pageIndex] ||= []).push(b);
}

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comic Translation Preview</title>
<style>
  body { margin: 0; padding: 16px; background: #1a1a1a; color: #eee; font-family: sans-serif; }
  h1 { text-align: center; font-size: 20px; }
  .summary { text-align: center; opacity: 0.7; font-size: 13px; margin-bottom: 20px; }
  .page { position: relative; display: block; width: min(90vw, 900px); margin: 32px auto; background: #000;
    border: 1px solid #444; }
  .page img { display: block; width: 100%; height: auto; }
  .trans { position: absolute; color: #fff; font-weight: 700; line-height: 1.15; overflow: hidden;
    text-shadow: 0 0 3px #000, 0 0 6px #000; word-break: break-word; white-space: pre-wrap; box-sizing: border-box; }
  .page-label { position: absolute; top: 2px; left: 2px; background: rgba(0,0,0,0.7); padding: 2px 8px;
    font-size: 12px; border-radius: 4px; z-index: 5; }
  .toggle { position: fixed; top: 8px; right: 8px; z-index: 50; background: #333; color: #eee; border: 1px solid #555;
    padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
</style></head><body>
<button class="toggle" onclick="document.body.classList.toggle('show-raw');this.textContent=document.body.classList.contains('show-raw')?'显示原文':'显示译文'">显示原文</button>
<h1>Comic Translation Preview</h1>
<div class="summary">${Object.keys(data.translations).length} translated bubbles · qwen2.5:14b</div>
${pageNums.map((num) => {
  const bubbles = bubblesByPage[num] || [];
  return `<div class="page" data-page="${num}">
    <div class="page-label">Page ${num}</div>
    <img src="pages/page-${String(num).padStart(3, '0')}.jpg" loading="lazy" />
    ${bubbles.map((b) => {
      const t = data.translations[b.id];
      if (!t) return '';
      const [[x1, y1], , [x2, y2]] = b.poly;
      const w = x2 - x1, h = y2 - y1;
      if (w <= 0 || h <= 0) return '';
      return `<div class="trans" data-raw="${escapeHtml(b.text)}" data-x="${x1}" data-y="${y1}" data-w="${w}" data-h="${h}" data-t="${escapeHtml(t)}"></div>`;
    }).join('')}
  </div>`;
}).join('')}
<script>
  // Position each overlay at runtime using the img's natural width.
  const DESIGN_H = 3282;
  document.querySelectorAll('.page').forEach((page) => {
    const img = page.querySelector('img');
    const overlay = (ev) => {
      const nw = img.naturalWidth || 2161;
      const nh = img.naturalHeight || 3282;
      page.querySelectorAll('.trans').forEach((el) => {
        const x = Number(el.dataset.x), y = Number(el.dataset.y);
        const w = Number(el.dataset.w), h = Number(el.dataset.h);
        el.style.left = ((x / nw) * 100).toFixed(4) + '%';
        el.style.top = ((y / nh) * 100).toFixed(4) + '%';
        el.style.width = ((w / nw) * 100).toFixed(4) + '%';
        el.style.height = ((h / nh) * 100).toFixed(4) + '%';
        el.style.fontSize = Math.max(9, Math.round(h / 18)) + 'px';
        el.textContent = el.dataset.t;
      });
    };
    if (img.complete) overlay(); else img.addEventListener('load', overlay);
  });
  // "show original" toggle swaps translation text for OCR text.
  document.body.addEventListener('click', (e) => {
    if (!e.target.classList.contains('trans')) return;
    const el = e.target;
    const tmp = el.dataset.t;
    el.dataset.t = el.dataset.raw;
    el.dataset.raw = tmp;
    el.textContent = el.dataset.t;
  });
</script>
</body></html>`;

writeFileSync(outHtml, html);
console.log(`Wrote ${outHtml} with ${pageNums.length} pages. Open in a browser.`);

function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
