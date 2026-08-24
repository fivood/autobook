/**
 * Evaluate JavaScript inside the running Tauri dev WebView2, over CDP.
 *
 *   npm run tauri:dev:cdp            # in one shell, leave it running
 *   node scripts/cdp-eval.mjs "location.pathname"
 *   node scripts/cdp-eval.mjs "$(cat probe.js)"
 *
 * Why this exists: the in-editor preview pane never composites, so
 * `requestAnimationFrame` never fires there — which silently disables
 * paginated rendering, scroll-driven progress, smooth scrolling and every CSS
 * animation. Those all look like app bugs and are not. Anything touching them
 * has to be checked against the real window; see CLAUDE.md §真机排查.
 *
 * The expression is awaited, so `(() => new Promise(r => …))()` works for
 * anything that needs to observe the app over time. Output is JSON.
 *
 * Exit codes: 0 ok, 1 page threw or no target found.
 */
const PORT = Number(process.env.TAURI_CDP_PORT || 9223);
const expression = process.argv[2];

if (!expression) {
  console.error('usage: node scripts/cdp-eval.mjs "<js expression>"');
  process.exit(1);
}

let targets;
try {
  targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
} catch {
  console.error(
    `[cdp-eval] nothing listening on 127.0.0.1:${PORT} — start \`npm run tauri:dev:cdp\` first`
  );
  process.exit(1);
}

// `about:blank` shows up here while the window is still booting; the app's own
// page is the one on the vite dev origin.
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.error('[cdp-eval] no page target:', JSON.stringify(targets, null, 2));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const slot = msg.id && pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
  else slot.resolve(msg.result);
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
}

try {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    // Some reader actions are gated on a user gesture (audio playback above
    // all); without this they reject and look broken.
    userGesture: true
  });

  if (res.exceptionDetails) {
    console.error(
      '[cdp-eval] page threw:',
      res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(res.result.value, null, 2));
  }
} catch (err) {
  // A navigation mid-evaluate kills the execution context. That is expected
  // when the expression itself reloads the page — re-run the probe after.
  console.error('[cdp-eval]', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
