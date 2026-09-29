/**
 * Evaluate JavaScript inside the running Tauri dev WebView2, over CDP.
 *
 *   npm run tauri:dev:cdp            # in one shell, leave it running
 *   node scripts/cdp-eval.mjs "location.pathname"
 *   node scripts/cdp-eval.mjs "$(cat probe.js)"
 *
 * The expression is awaited, so `(() => new Promise(r => …))()` works for
 * anything that needs to observe the app over time. Output is JSON.
 *
 * For a scripted suite rather than a one-shot probe, see smoke-test.mjs.
 * Exit codes: 0 ok, 1 page threw or nothing to connect to.
 */
import { connect } from './cdp-client.mjs';

const expression = process.argv[2];
if (!expression) {
  console.error('usage: node scripts/cdp-eval.mjs "<js expression>"');
  process.exit(1);
}

let session;
try {
  session = await connect();
} catch (err) {
  console.error(`[cdp-eval] ${err.message}`);
  process.exit(1);
}

try {
  console.log(JSON.stringify(await session.evaluate(expression), null, 2));
} catch (err) {
  // A navigation mid-evaluate kills the execution context. That is expected
  // when the expression itself reloads the page — re-run the probe after.
  console.error('[cdp-eval]', err.message);
  process.exitCode = 1;
} finally {
  session.close();
}
