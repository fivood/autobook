#!/usr/bin/env node
/**
 * Generate PWA icons from the vector source.
 *
 * Source: `static/logo.svg` — a single-path glyph of the "M" book stack,
 * no background. Rasterizing from SVG lets every size be pixel-sharp
 * (vs. the older flow that started from a 512px PNG and scaled).
 *
 * Output:
 *   - icon-192.png / icon-512.png        — PWA `purpose: any` (Android,
 *                                           also the iOS apple-touch-icon
 *                                           fallback list)
 *   - maskable-icon-192.png / -512.png   — PWA `purpose: maskable`. Logo
 *                                          shrunk to ~55% of canvas so
 *                                          Android adaptive icons can
 *                                          crop the outer ~20% without
 *                                          eating the glyph
 *   - apple-touch-icon.png               — 1024×1024 for iOS retina
 *                                          downscale (iOS picks the
 *                                          largest source it sees and
 *                                          downsamples crisply)
 *   - apple-touch-icon-180.png           — 180×180 native, kept as
 *                                          a sizes="180x180" entry for
 *                                          older iOS that won't browse
 *                                          a larger candidate
 *   - favicon-32.png                     — also regenerated for visual
 *                                          consistency
 *
 * Background is pure white (`#ffffff`) so every iOS squircle and Android
 * mask shows a clean tile with no transparent corners or accidental
 * color bleed.
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, '..', 'static');
const svgSource = resolve(staticDir, 'logo.svg');
const svgBuffer = readFileSync(svgSource);

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
// SVG viewBox: 324.62 × 389.73 → narrower than tall. Fit by height so a
// square canvas balances visually (logo sits in the vertical center with
// a tiny side margin).
const SVG_W = 324.62;
const SVG_H = 389.73;
const SVG_RATIO = SVG_W / SVG_H;

async function renderIcon(canvasSize, logoFraction, dst) {
  // logoFraction sizes the LOGO HEIGHT (the taller dimension). Computed
  // logoW always stays inside the canvas because the SVG is narrower.
  const logoH = Math.max(1, Math.round(canvasSize * logoFraction));
  const logoW = Math.max(1, Math.round(logoH * SVG_RATIO));

  // Rasterize the SVG at the exact target px size — sharp uses
  // librsvg with high-quality bezier rendering.
  const logoPng = await sharp(svgBuffer)
    .resize(logoW, logoH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const left = Math.round((canvasSize - logoW) / 2);
  const top = Math.round((canvasSize - logoH) / 2);
  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: WHITE }
  })
    .composite([{ input: logoPng, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(dst);

  console.log(`wrote ${dst} (${canvasSize}×${canvasSize}, logo ${logoW}×${logoH})`);
}

// Regular icons: logo at 65% of canvas — comfortable breathing room,
// looks like a proper iOS app icon on the home screen.
await renderIcon(192, 0.65, resolve(staticDir, 'icon-192.png'));
await renderIcon(512, 0.65, resolve(staticDir, 'icon-512.png'));

// Apple touch icons: 1024 for retina downscale, 180 for native fallback.
await renderIcon(1024, 0.65, resolve(staticDir, 'apple-touch-icon.png'));
await renderIcon(180, 0.65, resolve(staticDir, 'apple-touch-icon-180.png'));

// Maskable: Android adaptive icon mask cuts the outer ~20%. Shrinking
// the logo to ~55% keeps it fully inside the safe zone no matter the
// device's mask shape (circle / squircle / squircle-tall).
await renderIcon(192, 0.55, resolve(staticDir, 'maskable-icon-192.png'));
await renderIcon(512, 0.55, resolve(staticDir, 'maskable-icon-512.png'));

// Browser tab favicon. Smaller logo proportion since at 32px detail
// matters less than silhouette legibility.
await renderIcon(32, 0.75, resolve(staticDir, 'favicon-32.png'));
