/**
 * Save a PNG of the running Tauri dev window.
 *
 *   npm run tauri:dev:cdp
 *   node scripts/cdp-shot.mjs out.png
 *
 * For anything that needs looking at rather than asserting — layout, spacing,
 * whether a reading screen actually reads well. The editor preview pane cannot
 * do this (it never composites); the real window can.
 */
import { writeFileSync } from 'node:fs';
import { connect } from './cdp-client.mjs';

const out = process.argv[2] || 'shot.png';
const session = await connect();
try {
  writeFileSync(out, Buffer.from(await session.screenshot(), 'base64'));
  console.log(`wrote ${out}`);
} finally {
  session.close();
}
