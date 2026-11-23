/**
 * Launch `tauri dev` with the WebView2 remote-debugging port open so
 * Playwright can drive the packaged/dev app via CDP (see
 * docs/test-cases-ai.md §11.6). Run from the repo root:
 *
 *   npm run tauri:dev:cdp
 *
 * The CDP port defaults to 9223 (override with TAURI_CDP_PORT). The Vite
 * dev server port (vite.config.js `server.port`, default 5281) must be free:
 * tauri dev runs `vite dev` with strictPort and aborts otherwise — which is
 * the usual reason 9223 never appears.
 *
 * Two very different reasons a port won't bind, and this script used to report
 * both as "is another instance running?":
 *   EADDRINUSE — something really is listening; it will free up.
 *   EACCES     — on Windows the port sits in a reserved exclusion range
 *                (Hyper-V / WinNAT / Docker reserve blocks of a hundred at a
 *                time, and 9223 lands in one on plenty of machines). Nothing
 *                is listening and nothing ever will free it, so waiting is
 *                pointless — the fix is a different TAURI_CDP_PORT.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.TAURI_CDP_PORT || 9223);
const ARG = `--remote-debugging-port=${PORT}`;

/** null when the port binds, otherwise the errno code — see the header for
 *  why EADDRINUSE and EACCES need different advice. */
function probePort(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', (err) => resolve(err.code || 'EUNKNOWN'));
    srv.once('listening', () => srv.close(() => resolve(null)));
    srv.listen(port, '127.0.0.1');
  });
}

const portFree = async (port) => (await probePort(port)) === null;

/** First of `candidates` that actually binds — so the error can name a port
 *  the user can paste, instead of telling them to go find one. */
async function suggestPort(candidates = [9423, 9666, 10223, 11223]) {
  for (const p of candidates) {
    if ((await probePort(p)) === null) return p;
  }
  return null;
}

/** Wait for the port to become bindable. Resolves null on success, else the
 *  last errno. EACCES short-circuits: a reserved range never clears. */
function pollPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = async () => {
      const code = await probePort(port);
      if (code === null) return resolve(null);
      if (code === 'EACCES' || Date.now() - start > timeoutMs) return resolve(code);
      setTimeout(tick, 500);
    };
    tick();
  });
}

function vitePort() {
  try {
    const src = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    const m = src.match(/port:\s*(\d+)/);
    return m ? Number(m[1]) : 5281;
  } catch {
    return 5281;
  }
}

console.log(`[tauri:dev:cdp] will open CDP on 127.0.0.1:${PORT}`);
console.log(`[tauri:dev:cdp] vite dev port = ${vitePort()}`);

// Block until the CDP port is free so WebView2 can bind it on launch.
const blocked = await pollPort(PORT, 15000);
if (blocked === 'EACCES') {
  const alt = await suggestPort();
  console.error(
    `[tauri:dev:cdp] cannot bind 127.0.0.1:${PORT} — EACCES. Nothing is listening: on ` +
      `Windows this means the port is inside a reserved exclusion range. List them with
` +
      `    netsh interface ipv4 show excludedportrange protocol=tcp
` +
      (alt
        ? `  and use a port outside every range — ${alt} binds right now:
` +
          `    TAURI_CDP_PORT=${alt} npm run tauri:dev:cdp
` +
          `  Pass the same TAURI_CDP_PORT to cdp-eval.mjs / cdp-shot.mjs when you connect.`
        : `  and pick a port outside every range via TAURI_CDP_PORT.`)
  );
  process.exit(1);
}
if (blocked) {
  console.error(
    `[tauri:dev:cdp] port ${PORT} still held after 15s (${blocked}) — another dev instance is ` +
      `probably running. Find it with: Get-NetTCPConnection -LocalPort ${PORT} -State Listen`
  );
  process.exit(1);
}

// The vite strictPort is the usual failure point: if something else holds the
// dev port, `tauri dev`'s beforeDevCommand (vite) exits nonzero and the app
// never launches, so 9223 never opens. Surface that up front.
const vPort = vitePort();
const vBlocked = await probePort(vPort);
if (vBlocked) {
  console.error(
    `[tauri:dev:cdp] cannot bind vite dev port ${vPort} (${vBlocked}) — tauri dev will fail ` +
      `to start. ` +
      (vBlocked === 'EACCES'
        ? `Nothing is listening: it is inside a reserved exclusion range ` +
          `(netsh interface ipv4 show excludedportrange protocol=tcp). Move server.port in ` +
          `vite.config.js + devUrl in src-tauri/tauri.conf.json off that range.`
        : `Kill the process holding ${vPort}, or temporarily change server.port in ` +
          `vite.config.js + devUrl in src-tauri/tauri.conf.json, then retry.`)
  );
  process.exit(1);
}

const prevArg = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '';
if (!prevArg.includes(ARG)) {
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = prevArg ? `${prevArg} ${ARG}` : ARG;
  console.log(`[tauri:dev:cdp] set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS}"`);
}

const isWin = process.platform === 'win32';
// Windows: npm.cmd is a batch shim — spawning it directly hits EINVAL.
// Wrap in cmd.exe /d /c so the .cmd resolves and stdio inherits.
const child = isWin
  ? spawn('cmd.exe', ['/d', '/c', 'npm.cmd', 'run', 'tauri:dev'], { stdio: 'inherit', env: process.env })
  : spawn('npm', ['run', 'tauri:dev'], { stdio: 'inherit', env: process.env });

console.log('[tauri:dev:cdp] waiting for WebView2 to bind the CDP port…');
console.log(`[tauri:dev:cdp]   first Rust compile can take 1–2 min; 9223 appears after the window opens`);
console.log(`[tauri:dev:cdp]   meanwhile check: Get-NetTCPConnection -LocalPort ${PORT} -State Listen`);

// Report the moment 9223 becomes reachable, so the tester knows when to connect.
const readyTimer = setInterval(async () => {
  if (!(await portFree(PORT))) {
    console.log(`[tauri:dev:cdp] ✅ CDP is listening on 127.0.0.1:${PORT} — connect Playwright now`);
    clearInterval(readyTimer);
  }
}, 2000);

child.on('exit', (code) => {
  clearInterval(readyTimer);
  process.exit(code ?? 0);
});
