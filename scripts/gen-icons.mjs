import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'static/safari-pinned-tab.svg');

const out = (...p) => resolve(root, ...p);

async function render(size, dest, opts = {}) {
  await mkdir(dirname(dest), { recursive: true });
  let pipeline = sharp(src, { density: 384 }).resize(size, size, {
    fit: 'contain',
    background: opts.background || { r: 0, g: 0, b: 0, alpha: 0 }
  });
  if (opts.padPercent) {
    const pad = Math.round(size * opts.padPercent);
    const inner = size - pad * 2;
    const innerBuf = await sharp(src, { density: 384 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pipeline = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: opts.background || { r: 240, g: 239, b: 230, alpha: 1 }
      }
    }).composite([{ input: innerBuf, top: pad, left: pad }]);
  }
  await pipeline.png().toFile(dest);
  console.log(`✓ ${dest}`);
}

// PWA regular icons (transparent bg)
for (const size of [16, 32, 192, 512]) {
  await render(size, out(`static/icons/regular-icon@${size}x${size}.png`));
}
// PWA maskable icons (filled bg + ~10% safe-zone padding)
for (const size of [16, 32, 128, 192, 512]) {
  await render(size, out(`static/icons/maskable-icon@${size}x${size}.png`), {
    padPercent: 0.1,
    background: { r: 240, g: 239, b: 230, alpha: 1 }
  });
}
// favicon.png (128) + apple-touch-icon (180)
await render(128, out('static/favicon.png'));
await render(180, out('static/apple-touch-icon.png'), {
  padPercent: 0.08,
  background: { r: 240, g: 239, b: 230, alpha: 1 }
});

// 1024 source for tauri icon CLI (transparent)
await render(1024, out('scripts/.icon-1024.png'));

console.log('\nNext: npx tauri icon scripts/.icon-1024.png');
