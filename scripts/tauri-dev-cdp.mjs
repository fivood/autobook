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
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.TAURI_CDP_PORT || 9223);
const ARG = `--remote-debugging-port=${PORT}`;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function pollPort(port, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      if (await portFree(port)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
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
const free = await pollPort(PORT, 15000);
if (!free) {
  console.error(`[tauri:dev:cdp] port ${PORT} not free in 15s — is another instance running?`);
  process.exit(1);
}

// The vite strictPort is the usual failure point: if something else holds the
// dev port, `tauri dev`'s beforeDevCommand (vite) exits nonzero and the app
// never launches, so 9223 never opens. Surface that up front.
const vPort = vitePort();
if (!(await portFree(vPort))) {
  console.error(
    `[tauri:dev:cdp] vite dev port ${vPort} is in use — tauri dev will fail to start. ` +
      `Kill the process holding ${vPort}, or temporarily change server.port in ` +
      `vite.config.js + devUrl in src-tauri/tauri.conf.json, then retry.`
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
