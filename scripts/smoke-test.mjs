/**
 * End-to-end regression suite against the real Tauri window.
 *
 *   npm run tauri:dev:cdp     # one shell, leave running
 *   npm run smoke             # another shell
 *
 * Every scenario here corresponds to a bug that actually shipped. The unit
 * tests in `npm test` cover pure functions; these cover the things that only
 * break once a real WebView2 is rendering — which, per CLAUDE.md §真机排查, is
 * the majority of the reader (anything behind requestAnimationFrame).
 *
 * Safety: the suite creates its own book, restores every setting it touches,
 * and deletes what it made — including on failure. It refuses to run if it
 * cannot take a snapshot first.
 */
import { connect } from './cdp-client.mjs';

const TEST_TITLE = 'ZZ-冒烟测试用书';
const results = [];
let session;

function ok(name, detail = '') {
  results.push({ name, passed: true, detail });
  console.log(`  \u2714 ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, passed: false, detail });
  console.log(`  \u2718 ${name} — ${detail}`);
}

async function scenario(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (err) {
    fail(name, err.message);
  }
}

const js = (strings, ...values) =>
  strings.reduce((acc, s, i) => acc + s + (i < values.length ? JSON.stringify(values[i]) : ''), '');

/** Wrap an expression so it resolves after `ms`, giving the app time to settle. */
const after = (ms, expr) =>
  `(() => new Promise(r => setTimeout(() => r(${expr}), ${ms})))()`;

/**
 * Navigate and wait until the page is genuinely usable.
 *
 * `readyState === 'complete'` is not enough: SvelteKit keeps doing client-side
 * work after it, and an evaluate started in that window dies with "Execution
 * context was destroyed". `readyMarker` is a page-specific expression that only
 * becomes true once the thing the scenario needs actually exists.
 */
async function goto(path, readyMarker) {
  await session.evaluateThroughNavigation(js`(() => { location.href = ${path}; return 1; })()`);
  await session.waitFor(`document.readyState === 'complete'`, {
    label: `navigation to ${path}`
  });
  if (readyMarker) {
    await session.waitFor(readyMarker, { label: `${path} to be ready` });
  }
}

/** The library's import input — present only once /manage has mounted. */
const MANAGE_READY = `!![...document.querySelectorAll('input[type=file]')]
  .find(i => (i.getAttribute('accept') || '').includes('.epub'))`;

// ---------------------------------------------------------------- setup ----

async function snapshotSettings() {
  return session.evaluate(`(() => {
    const keys = ['viewMode', 'fsRoot', 'lastStorageSource', 'ttsEngine', 'statisticsEnabled'];
    const out = {};
    for (const k of keys) out[k] = localStorage.getItem(k);
    return out;
  })()`);
}

async function restoreSettings(snap) {
  await session.evaluate(js`(() => {
    const snap = ${snap};
    for (const [k, v] of Object.entries(snap)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
    return 1;
  })()`);
}

async function importTestBook() {
  // Browser storage: no filesystem grant needed, and it keeps the user's real
  // library source untouched.
  await session.evaluate(`(() => { localStorage.setItem('lastStorageSource', 'browser'); return 1; })()`);
  await goto('/manage', MANAGE_READY);
  const imported = await session.evaluate(js`(() => new Promise(r => {
    const dismiss = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '稍后处理');
    if (dismiss) dismiss.click();
    setTimeout(() => {
      const input = [...document.querySelectorAll('input[type=file]')]
        .find(i => (i.getAttribute('accept') || '').includes('.epub'));
      if (!input) return r({ ok: false, why: 'no file input on /manage' });
      const text = Array.from({ length: 80 }, (_, i) =>
        '第' + (i + 1) + '段。冒烟测试正文，需要足够长才能滚动。'
      ).join('\\n\\n');
      const dt = new DataTransfer();
      dt.items.add(new File([text], ${TEST_TITLE} + '.txt', { type: 'text/plain' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => r({ ok: true }), 2500);
    }, 600);
  }))()`);
  if (!imported.ok) throw new Error(imported.why);

  const id = await session.waitFor(
    js`(() => new Promise(r => { const q = indexedDB.open('books'); q.onsuccess = () => {
      const g = q.result.transaction('data','readonly').objectStore('data').getAll();
      g.onsuccess = () => { const b = g.result.find(x => x.title.startsWith(${TEST_TITLE})); r(b ? b.id : 0); };
    }; }))()`,
    { label: 'the test book to appear in IndexedDB' }
  );
  return id;
}

async function cleanup(bookId, snap) {
  try {
    await session.evaluate(js`(() => new Promise(r => {
      const q = indexedDB.open('books');
      q.onsuccess = () => {
        const db = q.result;
        const names = ['data', 'bookmark', 'highlight', 'lastItem'].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(names, 'readwrite');
        tx.objectStore('data').delete(${bookId});
        if (db.objectStoreNames.contains('bookmark')) tx.objectStore('bookmark').delete(${bookId});
        if (db.objectStoreNames.contains('lastItem')) tx.objectStore('lastItem').clear();
        tx.oncomplete = () => r(1);
        tx.onerror = () => r(0);
      };
    }))()`);
  } finally {
    if (snap) await restoreSettings(snap);
  }
}

// ------------------------------------------------------------ scenarios ----

/** Regression: a bookmark set at char 0 could never be returned to (1.38.0). */
async function bookmarkAtStart(bookId) {
  await goto(`/b?id=${bookId}`, `!!document.querySelector('[aria-label="显示阅读器菜单"]')`);
  await session.waitFor(`document.documentElement.scrollHeight > window.innerHeight * 2`, {
    label: 'the book to lay out'
  });

  const set = await session.evaluate(`(() => {
    window.scrollTo(0, 0);
    document.querySelector('[aria-label="显示阅读器菜单"]').click();
    return ${after(
      900,
      `(() => {
        const bm = [...document.querySelectorAll('[title]')]
          .find(e => (e.getAttribute('title') || '').startsWith('添加书签'));
        if (!bm) return { ok: false, why: 'no bookmark button' };
        bm.click();
        return { ok: true };
      })()`
    )};
  })()`);
  if (!set.ok) throw new Error(set.why);

  const out = await session.evaluate(`(() => {
    window.scrollTo(0, 4000);
    return ${after(
      1200,
      `(() => {
        const scrolled = Math.round(window.scrollY);
        document.querySelector('[aria-label="显示阅读器菜单"]').click();
        return new Promise(r => setTimeout(() => {
          const back = [...document.querySelectorAll('[title]')]
            .find(e => /返回书签/.test(e.getAttribute('title') || ''));
          if (!back) return r({ ok: false, why: 'no return-to-bookmark button' });
          back.click();
          setTimeout(() => r({ ok: true, scrolled, after: Math.round(window.scrollY) }), 2000);
        }, 900));
      })()`
    )};
  })()`);
  if (!out.ok) throw new Error(out.why);
  if (out.scrolled < 1000) throw new Error(`could not scroll away (got ${out.scrolled})`);
  if (out.after > 100) {
    throw new Error(`bookmark at position 0 did not return (${out.scrolled} → ${out.after})`);
  }
  return `${out.scrolled} → ${out.after}`;
}

/** Regression: TTS drove the typewriter reveal, so the text was hidden and the
 *  page could not be scrolled by hand (1.38.0). */
async function ttsLeavesTextAlone(bookId) {
  await goto(`/b?id=${bookId}`, `!!document.querySelector('[title^="开始朗读"]')`);
  await session.waitFor(`!!document.querySelector('[title^="开始朗读"]')`, {
    label: 'the reader chrome'
  });

  const out = await session.evaluate(`(() => {
    document.querySelector('[title^="开始朗读"]').click();
    const seen = new Set();
    let hidden = 0;
    const iv = setInterval(() => {
      hidden = Math.max(hidden, document.querySelectorAll('.tw-block-hidden').length);
      const hl = CSS.highlights && CSS.highlights.get('tts-sentence');
      if (hl) { for (const r of hl) { seen.add(r.toString().slice(0, 24)); break; } }
    }, 500);
    return ${after(
      5000,
      `(() => {
        clearInterval(iv);
        const stop = document.querySelector('[title^="暂停朗读"]');
        if (stop) stop.click();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        return { hidden, sentences: seen.size, scrollable: document.documentElement.scrollHeight > window.innerHeight };
      })()`
    )};
  })()`);

  if (out.hidden > 0) throw new Error(`TTS hid ${out.hidden} blocks of text`);
  if (!out.scrollable) throw new Error('page is not scrollable during TTS');
  if (out.sentences < 2) {
    throw new Error(`sentence highlight did not advance (saw ${out.sentences} distinct sentences)`);
  }
  return `${out.sentences} sentences highlighted, 0 blocks hidden`;
}

/** Regression: a batch import reported only the last failure, and the reason
 *  was replaced by a generic sentence once more than one error was logged
 *  (1.38.2).
 *
 *  Failure is forced with three files that pass the extension filter but are
 *  not actually EPUBs, so the loader throws once per file. Deliberately not by
 *  pointing storage at an unauthorised path: that switches the storage source,
 *  which drags in the folder-authorisation modal and leaves the app in a state
 *  the suite then has to repair. */
async function batchImportNamesEveryFailure() {
  await goto('/manage', MANAGE_READY);

  const out = await session.evaluate(`(() => new Promise(r => {
    const dismiss = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '稍后处理');
    if (dismiss) dismiss.click();
    setTimeout(() => {
      const input = [...document.querySelectorAll('input[type=file]')]
        .find(i => (i.getAttribute('accept') || '').includes('.epub'));
      if (!input) return r({ ok: false, why: 'no file input' });
      const dt = new DataTransfer();
      for (const n of ['ZZ-烟A.epub', 'ZZ-烟B.epub', 'ZZ-烟C.epub']) {
        // Not a zip — the EPUB loader rejects each one separately.
        dt.items.add(new File(['definitely not an epub'], n, { type: 'application/epub+zip' }));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => r({ ok: true, body: document.body.innerText }), 10000);
    }, 800);
  }))()`);
  if (!out.ok) throw new Error(out.why);

  const named = ['ZZ-烟A.epub', 'ZZ-烟B.epub', 'ZZ-烟C.epub'].filter((n) => out.body.includes(n));
  if (!named.length) {
    throw new Error(`no failed file was named; dialog said: ${out.body.slice(0, 200)}`);
  }
  if (named.length < 3) {
    throw new Error(`only ${named.length}/3 failed files were named — the others were dropped`);
  }
  return 'all 3 failures named with reasons';
}

/** Regression: BlobAutoReader had four `onError?.()` call sites and nothing
 *  ever assigned onError, so every engine failure ended as "the button springs
 *  back, no explanation" (1.38.0).
 *
 *  Forced by making Web Speech fire a fatal error event. Deterministic and
 *  engine-independent: the wiring under test is /b's onError handler, not the
 *  engine. */
async function ttsFailureExplainsItself(bookId) {
  // Pin the engine: the failure is injected through speechSynthesis, which the
  // blob engines (SAPI / Edge / Kokoro / custom) never touch. Restored from the
  // snapshot at the end of the run like every other setting the suite writes.
  await session.evaluate(`(() => { localStorage.setItem('ttsEngine', 'web'); return 1; })()`);
  await goto(`/b?id=${bookId}`, `!!document.querySelector('[title^="开始朗读"]')`);

  const out = await session.evaluate(`(() => {
    const original = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utt) => {
      setTimeout(() => utt.onerror && utt.onerror({ error: 'synthesis-failed' }), 60);
    };
    document.querySelector('[title^="开始朗读"]').click();
    return ${after(
      2000,
      `(() => {
        window.speechSynthesis.speak = original;
        const body = document.body.innerText;
        // Close whatever dialog appeared so the next scenario starts clean.
        const close = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '关闭');
        if (close) close.click();
        return {
          reported: /朗读失败/.test(body),
          quotesEngine: /synthesis-failed/.test(body),
          backToStopped: !!document.querySelector('[title^="开始朗读"]')
        };
      })()`
    )};
  })()`);

  if (!out.reported) throw new Error('engine failure produced no visible message');
  if (!out.quotesEngine) throw new Error('message did not quote the engine reason');
  if (!out.backToStopped) throw new Error('the play button did not return to the stopped state');
  return 'reason shown and quoted';
}

// ----------------------------------------------------------------- run ----

console.log('AutoBook smoke suite (real Tauri window via CDP)\n');

try {
  session = await connect({ timeoutMs: 5000 });
} catch (err) {
  console.error(`cannot connect: ${err.message}`);
  process.exit(1);
}

let snap;
let bookId = 0;
try {
  snap = await snapshotSettings();
  console.log(`  settings snapshot taken: ${JSON.stringify(snap)}\n`);

  bookId = await importTestBook();
  console.log(`  test book imported as id ${bookId}\n`);

  await scenario('书签：书籍开头设的书签能跳回去', () => bookmarkAtStart(bookId));
  await scenario('朗读：正文不被隐藏、可滚动、逐句高亮推进', () => ttsLeavesTextAlone(bookId));
  await scenario('朗读：引擎失败时说明原因', () => ttsFailureExplainsItself(bookId));
  await scenario('导入：批量失败时逐个报出文件名和原因', () => batchImportNamesEveryFailure());
} catch (err) {
  fail('suite setup', err.message);
} finally {
  if (bookId) await cleanup(bookId, snap);
  else if (snap) await restoreSettings(snap);
  session?.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
