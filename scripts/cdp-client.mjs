/**
 * Talk to the Tauri dev WebView2 over CDP. Shared by cdp-eval.mjs (one-shot
 * probes) and smoke-test.mjs (the regression suite).
 *
 * Why CDP and not the editor preview pane: the pane never composites, so
 * requestAnimationFrame never fires there and paginated rendering, scroll
 * progress, smooth scrolling and CSS animations are all dead. See CLAUDE.md
 * §真机排查.
 */
const DEFAULT_PORT = Number(process.env.TAURI_CDP_PORT || 9223);

export async function connect({ port = DEFAULT_PORT, timeoutMs = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let targets;
  for (;;) {
    try {
      targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      if (targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `nothing usable on 127.0.0.1:${port} — start \`npm run tauri:dev:cdp\` first`
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) for (const fn of listeners) fn(msg);
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

  /** Evaluate in the page. Promises are awaited; the value comes back by value. */
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      // Audio playback and some reader actions are gated on a user gesture.
      userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)
      );
    }
    return res.result.value;
  }

  /**
   * Evaluate, tolerating the execution context being torn down — which is what
   * happens whenever the expression itself navigates. Returns undefined then.
   */
  async function evaluateThroughNavigation(expression) {
    try {
      return await evaluate(expression);
    } catch (err) {
      if (String(err.message).includes('Execution context was destroyed')) return undefined;
      throw err;
    }
  }

  /** Poll `expression` until it is truthy. Returns its last value. */
  async function waitFor(expression, { timeoutMs: t = 30000, everyMs = 500, label = '' } = {}) {
    const until = Date.now() + t;
    for (;;) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {
        value = undefined; // mid-navigation
      }
      if (value) return value;
      if (Date.now() >= until) {
        throw new Error(`timed out waiting for ${label || expression}`);
      }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  /**
   * PNG of the real window, base64. Works where the editor preview pane's
   * screenshot does not: that pane never composites, this is an actual
   * compositing WebView2.
   */
  async function screenshot() {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    return res.data;
  }

  /**
   * A real left click at viewport coordinates. Synthetic `click()` / dispatched
   * MouseEvents don't move the selection, so anything that depends on where
   * the caret lands needs the input pipeline.
   */
  async function click(x, y) {
    const at = { x, y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
  }

  /**
   * Real keystrokes into whatever has focus, one keyDown/keyUp per character.
   * `el.value = …` or `Input.insertText` fire no keydown, so they can't catch
   * a window-level shortcut handler stealing keys mid-typing. ASCII only.
   */
  async function type(text) {
    for (const ch of text) {
      const upper = ch.toUpperCase();
      const code = ch === ' ' ? 'Space' : /[a-z]/i.test(ch) ? `Key${upper}` : '';
      const key = { key: ch, code, windowsVirtualKeyCode: upper.charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, ...key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    }
  }

  /** One named key (`ArrowRight`, `Escape`…) as a real keystroke. */
  const NAMED_KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Escape: 27, Enter: 13 };
  async function press(name) {
    const key = { key: name, code: name, windowsVirtualKeyCode: NAMED_KEYS[name] };
    if (!key.windowsVirtualKeyCode) throw new Error(`press(): unknown key ${name}`);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }

  /**
   * Start collecting uncaught exceptions and console.error calls from the
   * page. `take()` returns what arrived since the last take and clears it.
   * Survives navigations: Runtime events keep flowing on the same target.
   */
  async function watchErrors() {
    const seen = [];
    listeners.add((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        seen.push(`uncaught: ${(d.exception?.description || d.text || '').split('\n')[0]}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        seen.push(`console.error: ${text.split('\n')[0]}`);
      }
    });
    await send('Runtime.enable');
    return { take: () => seen.splice(0) };
  }

  return {
    evaluate,
    evaluateThroughNavigation,
    waitFor,
    screenshot,
    click,
    type,
    press,
    watchErrors,
    close: () => ws.close()
  };
}
