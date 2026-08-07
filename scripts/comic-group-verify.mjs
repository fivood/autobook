/**
 * Verify the improved bubble-grouping algorithm on real OCR output.
 * Replicates groupLinesToBubbles (comic-ocr-pipeline.ts) with the
 * horizontal-overlap-ratio fix, then reports how many bubbles each page
 * produces and whether known side-by-side bubbles now stay separate.
 */
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(process.argv[2] || 'C:/Users/fukki/AppData/Local/Temp/opencode/comic-test/ocr-results.json', 'utf8'));

function bbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY];
}
function verticalGap(a, b) { return Math.max(a[1], b[1]) - Math.min(a[3], b[3]); }
function horizontalOverlapRatio(a, b) {
  const overlapW = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (overlapW <= 0) return 0;
  const narrower = Math.min(a[2] - a[0], b[2] - b[0]);
  if (narrower <= 0) return 0;
  return overlapW / narrower;
}
function centroid(poly) {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  return [cx / poly.length, cy / poly.length];
}

function groupLinesToBubbles(items, pageIndex, imageHeight) {
  if (!items.length) return [];
  const lineHeight = imageHeight * 0.04;
  const maxGap = lineHeight * 1.5;
  const minOverlapRatio = 0.35;
  const boxes = items.map((it) => bbox(it.poly));
  const merged = new Array(items.length).fill(false);
  const groups = [];
  for (let i = 0; i < items.length; i++) {
    if (merged[i]) continue;
    const group = [i];
    merged[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < items.length; j++) {
        if (merged[j]) continue;
        for (const gi of group) {
          if (verticalGap(boxes[gi], boxes[j]) < maxGap && horizontalOverlapRatio(boxes[gi], boxes[j]) >= minOverlapRatio) {
            group.push(j);
            merged[j] = true;
            changed = true;
            break;
          }
        }
      }
    }
    groups.push(group);
  }
  const bubbles = groups.map((group, idx) => {
    group.sort((a, b) => centroid(items[a].poly)[1] - centroid(items[b].poly)[1]);
    const text = group.map((i) => items[i].text).join('\n');
    const allPts = group.flatMap((i) => items[i].poly);
    const [minX, minY, maxX, maxY] = bbox(allPts);
    return { id: `p${pageIndex}_b${idx}`, pageIndex, text, poly: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]], orderInPage: idx };
  });
  bubbles.sort((a, b) => centroid(a.poly)[1] - centroid(b.poly)[1]);
  return bubbles;
}

// Assume standard comic page height ~3300 (images vary; use per-page natural height estimate)
for (const r of data.results) {
  if (r.error) continue;
  const imageHeight = 3282; // typical; poly coords are image pixels
  const bubbles = groupLinesToBubbles(r.items, r.num, imageHeight);
  console.log(`page ${r.num}: ${bubbles.length} bubbles`);
  if (r.num === 19) {
    for (const b of bubbles) {
      console.log(`   [${b.id}] ${JSON.stringify(b.text).slice(0, 55)}`);
    }
  }
}
