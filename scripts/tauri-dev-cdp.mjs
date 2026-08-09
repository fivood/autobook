/**
 * Launch `tauri dev` with the WebView2 remote-debugging port open so
 * Playwright can drive the packaged/dev app via CDP (see
 * docs/test-cases-ai.md §11.6). Run from the repo root:
 *
 *   npm run tauri:dev:cdp
 *
 * The port is read from WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; default 9223.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

console.log(`[tauri:dev:cdp] will open CDP on 127.0.0.1:${PORT}`);

// Block until the port is free so WebView2 can bind it on launch.
const free = await pollPort(PORT, 15000);
if (!free) {
  console.error(`[tauri:dev:cdp] port ${PORT} not free in 15s — is another instance running?`);
  process.exit(1);
}

const prevArg = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '';
if (!prevArg.includes(ARG)) {
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = prevArg ? `${prevArg} ${ARG}` : ARG;
  console.log(`[tauri:dev:cdp] set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="${process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS}"`);
}

const isWin = process.platform === 'win32';
const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'tauri:dev'], {
  stdio: 'inherit',
  env: process.env
});

console.log(`[tauri:dev:cdp] after launch, connect Playwright to http://127.0.0.1:${PORT}`);
console.log(`[tauri:dev:cdp] check: Get-NetTCPConnection -LocalPort ${PORT} -State Listen`);

child.on('exit', (code) => process.exit(code ?? 0));
