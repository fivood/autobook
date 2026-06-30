#!/usr/bin/env node
/**
 * Take the existing round-on-transparent icons and emit full-bleed
 * square versions so iOS's home-screen squircle mask doesn't show a
 * black wedge in the corners.
 *
 * Strategy: sample the inner-circle background color from a known-safe
 * point, fill a fresh square with that color, then composite the
 * original (alpha-channel intact) on top. Visible result: same logo,
 * same background, just extends out to the four corners.
 *
 * Output filenames stay the same so `app.html` doesn't need to change.
 * Maskable variants get the same treatment — they were also
 * circle-on-transparent, which means an aggressive Android adaptive
 * mask could also have eaten edge pixels.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, '..', 'static');

/** Sample bg color from the top of the circle's interior — just below
 *  the topmost arc. (0.5w, 0.08h) on a 512px source = (256, 41), well
 *  above the book-stack glyph which starts around y=0.2. */
async function sampleBg(srcPath) {
  const img = sharp(srcPath);
  const { width, height } = await img.metadata();
  const x = Math.round(width * 0.5);
  const y = Math.round(height * 0.08);
  const { data, info } = await img
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * 4;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
    a: data[idx + 3]
  };
}

async function fillBg(srcPath, dstPath, bg) {
  const meta = await sharp(srcPath).metadata();
  const w = meta.width;
  const h = meta.height;
  const background = { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background
    }
  })
    .composite([{ input: srcPath }])
    .png({ compressionLevel: 9 })
    .toFile(dstPath);
}

const targets = [
  'icon-192.png',
  'icon-512.png',
  'maskable-icon-192.png',
  'maskable-icon-512.png'
];

const bg = await sampleBg(resolve(staticDir, 'icon-512.png'));
console.log(`sampled bg color: rgba(${bg.r}, ${bg.g}, ${bg.b}, ${bg.a})`);

for (const name of targets) {
  const src = resolve(staticDir, name);
  const dst = src; // overwrite in place
  await fillBg(src, dst, bg);
  console.log(`wrote ${name}`);
}

// Also emit a dedicated Apple-touch-icon at iOS's canonical 180×180. Some
// older iOS versions look here first; pointing at icon-192 sort of works
// but produces a tiny letterbox at the squircle edges.
const appleSrc = resolve(staticDir, 'icon-512.png');
const appleDst = resolve(staticDir, 'apple-touch-icon.png');
await sharp({
  create: {
    width: 180,
    height: 180,
    channels: 4,
    background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 }
  }
})
  .composite([
    {
      input: await sharp(appleSrc).resize(180, 180).png().toBuffer()
    }
  ])
  .png({ compressionLevel: 9 })
  .toFile(appleDst);
console.log('wrote apple-touch-icon.png (180×180)');
