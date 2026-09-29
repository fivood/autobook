/**
 * Translate comic OCR results into Chinese using a local Ollama model, then
 * emit an overlay JSON (bubble id → translation + poly) for inspection.
 *
 *   node scripts/comic-translate.mjs <ocr-results.json> <out.json> [model]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inFile, outFile, modelArg] = process.argv;
if (!inFile || !outFile) {
  console.error('Usage: node scripts/comic-translate.mjs <ocr.json> <out.json> [model]');
  process.exit(1);
}
const model = modelArg || '<LOCAL_MODEL>';
const baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const data = JSON.parse(readFileSync(inFile, 'utf8'));

// ---- Bubble grouping (mirrors comic-ocr-pipeline.groupLinesToBubbles) ----
function bbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
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
  bubbles.forEach((b, i) => { b.orderInPage = i; b.id = `p${pageIndex}_b${i}`; });
  return bubbles;
}
function centroid(poly) {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  return [cx / poly.length, cy / poly.length];
}

// ---- Group all pages ----
const allBubbles = [];
for (const r of data.results) {
  if (r.error) continue;
  const bubbles = groupLinesToBubbles(r.items, r.num, 3300);
  allBubbles.push(...bubbles);
  console.log(`page ${r.num}: ${bubbles.length} bubbles`);
}
console.log(`Total ${allBubbles.length} bubbles across all pages.`);

// ---- Translate via Ollama ----
async function translateBubble(text) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0.3 },
      messages: [
        {
          role: 'system',
          content:
            '你是一名漫画翻译。把英文对话/拟声词翻译成自然的中文，保留原意和语气。' +
            '拟声词（如 WHACK!/SPLAT!/HAHAHA）翻译成常见中文拟声词或直接保留。' +
            '只输出译文本身，不要解释，不要加引号。多行保持多行。'
        },
        { role: 'user', content: text }
      ]
    })
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return String(json?.message?.content || '').trim();
}

const translations = {};
let done = 0;
let failed = 0;
// Batch to keep context small; sequential to avoid hammering local GPU.
for (let i = 0; i < allBubbles.length; i++) {
  const b = allBubbles[i];
  try {
    const t = await translateBubble(b.text);
    if (t) translations[b.id] = t;
    done++;
    if (i % 10 === 0 || i === allBubbles.length - 1) {
      console.log(`translated ${done}/${allBubbles.length} (${failed} failed)`);
    }
  } catch (err) {
    failed++;
    console.error(`bubble ${b.id} failed: ${err.message}`);
  }
}

// ---- Emit overlay JSON ----
const overlay = {
  source: data,
  translations,
  bubbles: allBubbles.map(({ id, pageIndex, poly, text, orderInPage }) => ({ id, pageIndex, poly, text, orderInPage })),
  summary: {
    totalBubbles: allBubbles.length,
    translated: Object.keys(translations).length,
    failed
  }
};
writeFileSync(outFile, JSON.stringify(overlay, null, 2));
console.log(`\nWrote ${outFile}`);
console.log(`Translated ${Object.keys(translations).length}/${allBubbles.length} bubbles, ${failed} failed.`);
