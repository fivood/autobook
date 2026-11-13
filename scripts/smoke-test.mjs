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
 *
 * Every reader scenario runs once per view mode (`SMOKE_VIEW=continuous` or
 * `=paginated` to run one). They used to run in scroll mode only — and one of
 * them quietly forced it — so "the suite is green" said nothing about the
 * paginated reader, which has its own key handling, bookmarking and layout.
 */
import { connect } from './cdp-client.mjs';

const TEST_TITLE = 'ZZ-冒烟测试用书';
const results = [];
let session;
let errors;

const MODES = (process.env.SMOKE_VIEW || 'continuous,paginated')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const MODE_LABEL = { continuous: '滚动', paginated: '分页' };
/** The view mode the current scenario runs in. */
let mode = MODES[0];
/** `modes` value for scenarios that don't touch the reader's view at all. */
const ONCE = 'once';

function ok(name, detail = '') {
  results.push({ name, passed: true, detail });
  console.log(`  \u2714 ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  results.push({ name, passed: false, detail });
  console.log(`  \u2718 ${name} — ${detail}`);
}

/**
 * Every visible control must be the topmost thing at its own centre. This is
 * the shape of several real bugs: the TOC under its own backdrop (acb8bbd),
 * the image-zoom pill over the reading tracker, a banner over the header
 * title. A fixed element covering most of the window is a modal backdrop
 * doing its job, not an overlap.
 */
const COVERED_CONTROLS = `(async () => {
  // Let transitions finish first: a header sliding away is still "visible"
  // for a moment while the tap strip that replaces it is already on top.
  for (let i = 0; i < 20 && document.getAnimations().some((a) => a.playState === 'running'); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const desc = (e) => {
    const t = e.getAttribute && (e.getAttribute('title') || e.getAttribute('aria-label'));
    const cls = (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '')
      .toString().split(' ').slice(0, 3).join('.');
    return e.tagName.toLowerCase() + (cls ? '.' + cls : '') + (t ? '[' + t.slice(0, 30) + ']' : '');
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (e.closest('details:not([open])') && !e.closest('summary')) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const backdrop = (e) => {
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      if (getComputedStyle(x).position !== 'fixed') continue;
      const r = x.getBoundingClientRect();
      if (r.width * r.height > innerWidth * innerHeight * 0.9) return true;
    }
    return false;
  };
  const covered = [];
  for (const e of document.querySelectorAll('button, a[href], [role=button], [role=menuitem], input:not([type=hidden]), select, textarea, [title]')) {
    if (!visible(e)) continue;
    if (e.closest('.book-content') && !e.matches('a[href],button')) continue;
    if (getComputedStyle(e).pointerEvents === 'none') continue;
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // A centre off screen is something sliding in or out (the header's fly
    // transition); clamping it to the edge used to hit whatever sits there.
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || top === e || e.contains(top) || top.contains(e) || backdrop(top)) continue;
    covered.push(desc(e) + ' ← ' + desc(top));
  }
  return covered;
})()`;

/**
 * `modes`: which view modes the scenario runs in (default: all of MODES), or
 * ONCE for scenarios that never look at the reader's view.
 * `allowErrors`: console errors the scenario provokes on purpose.
 */
async function scenario(name, fn, { allowErrors } = {}) {
  // SMOKE_ONLY=<substring> runs just the matching scenarios — for the
  // revert-the-fix self-check without sitting through the whole suite.
  if (process.env.SMOKE_ONLY && !name.includes(process.env.SMOKE_ONLY)) return;
  errors.take();
  try {
    const detail = await fn();
    // Two invariants after every scenario: no stray errors on the way, and
    // nothing on screen sitting on top of another control.
    const stray = errors.take().filter((e) => !(allowErrors && allowErrors.test(e)));
    if (stray.length) throw new Error(`page errors: ${stray.slice(0, 3).join(' | ')}`);
    const covered = await session.evaluate(COVERED_CONTROLS);
    if (covered.length) throw new Error(`controls covered: ${covered.slice(0, 3).join(' | ')}`);
    ok(name, detail);
  } catch (err) {
    fail(name, err.message);
  }
}

/** Set the view mode for the next page load; scenarios must not depend on the machine's. */
async function useMode(m) {
  mode = m;
  // lastStorageSource too: the test book lives in browser storage, and the
  // per-scenario restore puts back the user's own source.
  await session.evaluate(js`(() => {
    localStorage.setItem('viewMode', ${m});
    localStorage.setItem('lastStorageSource', 'browser');
    return 1;
  })()`);
}

/**
 * The first page loads after a lockfile or vite.config change make Vite
 * discover dependencies and reload the page on its own, a few times. Inside a
 * scenario that is an "Execution context was destroyed" or a broken HMR
 * component; take the hits here instead.
 */
async function warmUp(path, ready) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await goto(path, ready);
      await pause(4000);
      if (await session.evaluate(ready)) return;
    } catch {
      // reloaded under us — that is the point; try again
    }
  }
}

const READER_READY = `!!document.querySelector('[aria-label="显示阅读器菜单"]')`;

/** Enough of the book is rendered to move around in. Scroll mode: the page
 *  scrolls; paginated: the current chapter's paragraphs are in. */
const laidOut = () =>
  mode === 'continuous'
    ? `document.documentElement.scrollHeight > window.innerHeight * 2`
    : `document.querySelectorAll('.book-content p').length > 20`;

/** The first paragraph or heading on screen, either axis — "where am I" in
 *  both modes (paginated content moves by columns, not by scrollY). */
const WHERE = `(() => {
  const v = [...document.querySelectorAll('.book-content p, .book-content h2')].find((p) => {
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });
  return v ? v.textContent.trim().slice(0, 8) : null;
})()`;

/** Leave the start of the book: scroll down, or flip a few pages. */
async function moveAway() {
  if (mode === 'continuous') {
    await session.evaluate(`(() => { window.scrollTo(0, 4000); return 1; })()`);
  } else {
    await session.evaluate(`(() => { document.activeElement?.blur?.(); return 1; })()`);
    for (let i = 0; i < 3; i += 1) {
      await session.press('ArrowRight');
      await pause(400);
    }
  }
  await pause(1200);
}

/** Delete the book's saved position so the next open starts at the top. */
const forgetBookmark = (bookId) =>
  session.evaluate(js`new Promise((r) => {
    const q = indexedDB.open('books');
    q.onsuccess = () => {
      const tx = q.result.transaction('bookmark', 'readwrite');
      tx.objectStore('bookmark').delete(${bookId});
      tx.oncomplete = () => r(1);
    };
  })`);

const savedPosition = (bookId) =>
  session.evaluate(js`new Promise((r) => {
    const q = indexedDB.open('books');
    q.onsuccess = () => {
      const g = q.result.transaction('bookmark').objectStore('bookmark').get(${bookId});
      g.onsuccess = () => r(g.result ? g.result.exploredCharCount : null);
    };
  })`);

/** Open the reader menu if it is closed, so the header buttons exist. */
async function showReaderMenu(probeTitle) {
  for (let k = 0; k < 3; k += 1) {
    const there = await session.evaluate(js`[...document.querySelectorAll('[title]')]
      .some((e) => (e.getAttribute('title') || '').startsWith(${probeTitle}) && e.getBoundingClientRect().width > 0)`);
    if (there) return;
    await session.evaluate(`(() => { document.querySelector('[aria-label="显示阅读器菜单"]').click(); return 1; })()`);
    await pause(800);
  }
  throw new Error(`reader menu has no visible "${probeTitle}"`);
}

/**
 * Build a JS expression with values safely embedded.
 *
 * Careful: this is a *tagged* template, so the cooked strings have already had
 * their escapes processed. `\s` and `\d` arrive here as plain `s` and `d`,
 * which turns a regex into one that silently matches nothing — no error, just
 * a scenario that reports null forever. Cost an afternoon once. When the
 * expression contains regex escapes, use an ordinary template literal and
 * `JSON.stringify` the values by hand.
 */
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
    // activeFolderFilter is here because the archive scenario parks the library
    // on 「已归档」 while it works. A run that failed midway used to leave it
    // there, and every later run started in a view the test book is not in —
    // reported as "the test book was not on the shelf to begin with", which
    // says nothing about the actual cause.
    const keys = [
      'viewMode',
      'fsRoot',
      'lastStorageSource',
      'ttsEngine',
      'ttsStartStrategy',
      'ttsPositions',
      'statisticsEnabled',
      'activeFolderFilter',
      'autoScrollMultiplier',
      'autoBookmark',
      'autoBookmarkTime',
      'manualBookmark'
    ];
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
      // Two chapters (第41段 opens the second) so the TOC and the chapter keys
      // have somewhere to go. The headings become <h2>, so the paragraphs are
      // still the only <p>s and p[i] is still 第(i+1)段.
      const text = Array.from({ length: 80 }, (_, i) =>
        (i === 0 ? '第1章 开头\\n\\n' : i === 40 ? '第2章 后半\\n\\n' : '') +
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
    // Every row the run can leave behind. Highlights hang off the book id;
    // reading statistics, sessions and their sync stamps off the title — those
    // were never deleted, and dozens of 「ZZ-冒烟测试用书」 rows piled up in the
    // dev library's notebook and statistics pages. lastItem holds one row (the
    // last book opened) and is only ours to remove if it points at the test book.
    await session.evaluate(js`(() => new Promise(r => {
      const q = indexedDB.open('books');
      q.onsuccess = () => {
        const db = q.result;
        const names = [
          'data', 'bookmark', 'highlight', 'lastItem', 'archived', 'statistic', 'session', 'lastModified'
        ].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(names, 'readwrite');
        const sweep = (name, hit) => {
          if (!names.includes(name)) return;
          tx.objectStore(name).openCursor().onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            if (hit(c.key, c.value || {})) c.delete();
            c.continue();
          };
        };
        const ours = (title) => String(title || '').startsWith(${TEST_TITLE});
        tx.objectStore('data').delete(${bookId});
        if (names.includes('bookmark')) tx.objectStore('bookmark').delete(${bookId});
        sweep('highlight', (_, v) => v.dataId === ${bookId});
        sweep('lastItem', (_, v) => v.dataId === ${bookId});
        // The archive is keyed by title and outlives the book row on purpose,
        // so it needs clearing explicitly or a failed run leaves the suite's
        // book hidden from the library forever.
        sweep('archived', (k) => ours(k));
        sweep('statistic', (_, v) => ours(v.title));
        sweep('session', (_, v) => ours(v.title));
        sweep('lastModified', (_, v) => ours(v.title));
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
  // Only the manual bookmark: an auto-bookmark firing while we page away
  // would overwrite it, and that is the auto-bookmark working, not this bug.
  await session.evaluate(`(() => { localStorage.setItem('autoBookmark', '0'); return 1; })()`);
  await forgetBookmark(bookId);
  await goto(`/b?id=${bookId}`, READER_READY);
  await session.waitFor(laidOut(), { label: 'the book to lay out' });
  await pause(800);

  const start = await session.evaluate(WHERE);
  await showReaderMenu('添加书签');
  await session.evaluate(`(() => {
    [...document.querySelectorAll('[title]')]
      .find(e => (e.getAttribute('title') || '').startsWith('添加书签')).click();
    return 1;
  })()`);
  await pause(600);

  await moveAway();
  const away = await session.evaluate(WHERE);
  if (paragraphNumber(away) < 5) throw new Error(`could not move away from the start (at ${away})`);

  await showReaderMenu('返回书签');
  await session.evaluate(`(() => {
    [...document.querySelectorAll('[title]')]
      .find(e => /返回书签/.test(e.getAttribute('title') || '')).click();
    return 1;
  })()`);
  await pause(2000);
  const back = await session.evaluate(WHERE);
  if (paragraphNumber(back) > 1) {
    throw new Error(`bookmark at position 0 did not return (${start} → ${away} → ${back})`);
  }
  return `${start} → ${away} → ${back}`;
}

/** Regression: TTS drove the typewriter reveal, so the text was hidden and the
 *  page could not be scrolled by hand (1.38.0). */
async function ttsLeavesTextAlone(bookId) {
  // Pinned like the other voice scenarios: left to the machine's engine, a
  // custom HTTP endpoint never spoke within the window and this went red.
  await session.evaluate(`(() => {
    localStorage.setItem('ttsEngine', 'sapi');
    localStorage.setItem('ttsStartStrategy', 'selection');
    return 1;
  })()`);
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
  // Paginated pages never scroll; there the hidden-block count is the check.
  if (mode === 'continuous' && !out.scrollable) throw new Error('page is not scrollable during TTS');
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
/**
 * Regression: 「选中一段 → 高亮 → 按播放」 started at the saved resume
 * position instead of at the passage the user had just marked (1.45.0).
 *
 * Applying a highlight calls removeAllRanges() — the selection overlay would
 * sit on top of the fresh mark — so by the time the play button is reached
 * there is no live selection for the 'selection' start strategy to read, and
 * it fell through to the resume position. The unit test in
 * scripts/tts-start-position-test.ts covers the bookkeeping; only the real
 * window can show that the browser does drop the selection at that moment,
 * and that a Range kept instead of a char index would not have survived the
 * renderer re-wrapping those text nodes in <mark>.
 *
 * Engine pinned to SAPI: the sentence highlight is the only observable for
 * "where did it start", and it needs a voice that actually speaks. Windows
 * ships SAPI, so this does not depend on what is installed on the box.
 */
async function ttsStartsAtTheHighlightedPassage(bookId) {
  // It runs once per mode; the second run must not find the first's mark.
  await session.evaluate(js`new Promise((r) => {
    const q = indexedDB.open('books');
    q.onsuccess = () => {
      const tx = q.result.transaction('highlight', 'readwrite');
      tx.objectStore('highlight').openCursor().onsuccess = (ev) => {
        const c = ev.target.result;
        if (!c) return;
        if (c.value.dataId === ${bookId}) c.delete();
        c.continue();
      };
      tx.oncomplete = () => r(1);
    };
  })`);
  await session.evaluate(`(() => {
    localStorage.setItem('ttsEngine', 'sapi');
    localStorage.setItem('ttsStartStrategy', 'selection');
    return 1;
  })()`);
  await goto(`/b?id=${bookId}`, `!!document.querySelector('[title^="开始朗读"]')`);
  await session.waitFor(`document.querySelectorAll('.book-content p').length > 35`, {
    label: 'the test book text'
  });

  // Paragraph 31: far enough from the resume position (paragraph 0 on a book
  // that was just imported) that a wrong start is unambiguous, and inside the
  // first chapter — the one the paginated reader has in the DOM on open.
  const target = 30;
  const out = await session.evaluate(`(() => {
    const p = document.querySelectorAll('.book-content p')[${target}];
    const tn = [...p.childNodes].find((x) => x.nodeType === 3);
    const r = document.createRange();
    r.setStart(tn, 2);
    r.setEnd(tn, 8);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const box = p.getBoundingClientRect();
    p.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: Math.round(box.left + 20),
      clientY: Math.round(box.top + 5)
    }));
    return new Promise((done) => setTimeout(() => {
      const swatch = document.querySelector('.menu-toolbar button');
      if (!swatch) return done({ ok: false, why: 'the selection menu did not open' });
      swatch.click();
      // The highlight is written to IndexedDB and re-rendered before the
      // selection is dropped; play only after that has settled.
      setTimeout(() => {
        const marks = document.querySelectorAll('.book-content mark[data-hl-id]').length;
        const live = (getSelection() || {}).rangeCount || 0;
        document.querySelector('[title^="开始朗读"]').click();
        const seen = [];
        const poll = setInterval(() => {
          const hl = CSS.highlights && CSS.highlights.get('tts-sentence');
          if (!hl) return;
          for (const range of hl) {
            const text = range.toString();
            if (text && !seen.includes(text)) seen.push(text);
            break;
          }
        }, 250);
        setTimeout(() => {
          clearInterval(poll);
          document.querySelector('[title^="暂停朗读"]')?.click();
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          done({ ok: true, marks, live, spoken: seen[0] || null, count: seen.length });
        }, 6000);
      }, 1200);
    }, 400));
  })()`);

  if (!out.ok) throw new Error(out.why);
  if (!out.marks) throw new Error('the highlight was never applied');
  if (!out.spoken) throw new Error('the sentence highlight never appeared — did the voice start?');
  // Plain template + explicit escape: the js`` tag would eat the \\d.
  const at = /第(\d+)段/.exec(out.spoken);
  if (!at) throw new Error(`spoke something unexpected: ${out.spoken.slice(0, 30)}`);
  if (Number(at[1]) !== target + 1) {
    throw new Error(
      `started at 第${at[1]}段, wanted 第${target + 1}段 (the highlighted one)`
    );
  }
  return `从第${at[1]}段起读（共听到 ${out.count} 句），高亮已落地，按播放时活动选区 ${out.live} 个`;
}

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

/**
 * Not a shipped regression — archiving is new in 1.39.0. It is here because
 * its failure mode is the one this app has produced twice already and users
 * cannot diagnose: a book that is simply *not in the library*, with nothing
 * on screen to say why. An inverted filter, an archive flag that outlives its
 * book, or a sidebar row that never appears all look identical to "my book is
 * gone". See the note in CLAUDE.md §冒烟套件.
 */
async function archiveHidesAndRestores(bookId) {
  // Start from a known view rather than whatever the last run left behind.
  await session.evaluate(`(() => { localStorage.setItem('activeFolderFilter', 'all'); return 1; })()`);
  await goto('/manage', MANAGE_READY);

  // Ask the CARDS, not the header. The header's 退出多选 title also sits on the
  // exit button, which lingers in the DOM through its out transition — so
  // "is select mode on" answered yes for ~150ms after it was switched off,
  // and this helper skipped the click it needed to make. Cards carry
  // `.select-mode` for exactly as long as the mode is on.
  const inSelectMode = `!!document.querySelector('.book-grid-item.select-mode')`;

  /**
   * Leaves the library IN select mode, whatever state it started in.
   *
   * It used to click the toggle blind and hope. Two ways that lied: a library
   * already in select mode got switched off, and 归档 flips the mode off
   * itself one microtask after the book disappears — which is exactly when
   * this runs. Either way the next card click OPENED the book, and the
   * scenario reported "the unarchive button never appeared" while sitting in
   * the reader.
   */
  const enterSelect = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await session.evaluate(`(() => {
        const dismiss = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '稍后处理');
        if (dismiss) dismiss.click();
        if (${inSelectMode}) return { ok: true, on: true };
        const svg = document.querySelector('svg[role=button][aria-label]');
        if (!svg) return { ok: false, why: 'no select-mode toggle' };
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { ok: true, on: false };
      })()`);
      if (!state.ok) return state;
      if (state.on) return state;
      try {
        await session.waitFor(inSelectMode, { label: 'select mode to switch on', timeoutMs: 3000 });
        return { ok: true };
      } catch {
        // Something turned it back off between the click and the check; the
        // loop re-reads the real state instead of trusting the click.
      }
    }
    return { ok: false, why: 'select mode would not stay on' };
  };

  let lastClick = null;
  const clickCard = async () => {
    const r = await session.evaluate(js`(() => {
      const nodes = [...document.querySelectorAll('div,article,li')].filter(
        (e) => e.innerText && e.innerText.trim().startsWith(${TEST_TITLE})
          && e.querySelectorAll('div,article,li').length < 6
      );
      const card = nodes[nodes.length - 1];
      if (!card) return { ok: false, why: 'test book not on the shelf' };
      const modeBefore = [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
        .find((t) => t === '退出多选' || t === '进入多选') || 'none';
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return {
        ok: true,
        modeBefore,
        matches: nodes.length,
        picked: (card.className || '').toString().slice(0, 60),
        inCard: !!card.closest('.book-card-root')
      };
    })()`);
    lastClick = r;
    return r;
  };

  const expectSelection = async (where) => {
    try {
      await session.waitFor(
        `[...document.querySelectorAll('.book-grid-item')].some((c) => c.querySelector('[title="已选中书籍"]'))`,
        { label: `the card click to select a book (${where})`, timeoutMs: 5000 }
      );
    } catch (err) {
      const seen = await session.evaluate(`({
        path: location.pathname,
        mode: [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
          .find((t) => t === '退出多选' || t === '进入多选') || 'none',
        cards: document.querySelectorAll('.book-grid-item').length
      })`);
      throw new Error(
        `${err.message} | ${JSON.stringify(seen)} | click=${JSON.stringify(lastClick)}`
      );
    }
  };

  const clickByTitlePrefix = async (prefix) => session.evaluate(js`(() => {
    const btn = [...document.querySelectorAll('[title]')]
      .find((e) => (e.getAttribute('title') || '').startsWith(${prefix}));
    if (!btn) return { ok: false, why: 'no button titled ' + ${prefix} };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  })()`);

  // Deliberately NOT the `js` tag — see its definition. A regex escape inside
  // a tagged template loses its backslash, and `/已归档\s+(\d+)/` would arrive
  // as `/已归档s+(d+)/`: matches nothing, reports nothing, just quietly wrong.
  const shelf = async () => session.evaluate(`(() => {
    const text = document.body.innerText;
    const row = text.match(/已归档\\s+(\\d+)/);
    return {
      onShelf: text.includes(${JSON.stringify(TEST_TITLE)}),
      archivedCount: row ? Number(row[1]) : null
    };
  })()`);

  // MANAGE_READY only proves the page mounted; the card list arrives later.
  // Waiting on the mount alone made this scenario flaky in both directions —
  // "not on the shelf to begin with" here, and a missing toolbar button below.
  try {
    await session.waitFor(js`document.body.innerText.includes(${TEST_TITLE})`, {
      label: 'the test book to appear on the shelf',
      timeoutMs: 15000
    });
  } catch (err) {
    const seen = await session.evaluate(
      `({ source: localStorage.getItem('lastStorageSource'), path: location.pathname, body: document.body.innerText.slice(0, 300) })`
    );
    throw new Error(`${err.message} | ${JSON.stringify(seen)}`);
  }
  const before = await shelf();
  if (!before.onShelf) throw new Error('the test book was not on the shelf to begin with');

  for (const step of [enterSelect, clickCard]) {
    const r = await step();
    if (!r.ok) throw new Error(r.why);
  }
  // Prove the click selected instead of opening the book, here rather than
  // three steps later as a missing toolbar button.
  // Count the tick, not `.absolute.inset-0` — the cover image carries those
  // same two classes, so the naive selector reported "selected" for every
  // card on the shelf and the assertion passed while nothing was selected.
  await expectSelection('before archiving');
  await session.waitFor(
    `[...document.querySelectorAll('[title]')].some((e) => (e.getAttribute('title') || '').startsWith('归档'))`,
    { label: 'the archive button to appear' }
  );
  const archived = await clickByTitlePrefix('归档');
  if (!archived.ok) throw new Error(archived.why);

  await session.waitFor(js`!document.body.innerText.includes(${TEST_TITLE})`, {
    label: 'the archived book to leave the library'
  });
  const hidden = await shelf();
  if (hidden.archivedCount !== 1) {
    throw new Error(`sidebar shows 已归档 = ${hidden.archivedCount}, expected 1`);
  }

  // The archive view is the only place it should still be visible.
  const opened = await session.evaluate(`(() => {
    const row = [...document.querySelectorAll('button')].find((b) => /已归档/.test(b.innerText));
    if (!row) return { ok: false, why: 'no 已归档 row to open' };
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true };
  })()`);
  if (!opened.ok) throw new Error(opened.why);
  await session.waitFor(js`document.body.innerText.includes(${TEST_TITLE})`, {
    label: 'the archive view to list the book'
  });

  for (const step of [enterSelect, clickCard]) {
    const r = await step();
    if (!r.ok) throw new Error(r.why);
  }
  // Prove the click selected instead of opening the book, here rather than
  // three steps later as a missing toolbar button.
  // Count the tick, not `.absolute.inset-0` — the cover image carries those
  // same two classes, so the naive selector reported "selected" for every
  // card on the shelf and the assertion passed while nothing was selected.
  await expectSelection('in the archive view');
  // The toolbar only renders once a selection exists, and the click above is
  // asynchronous as far as this side is concerned.
  try {
    await session.waitFor(
      `[...document.querySelectorAll('[title]')].some((e) => (e.getAttribute('title') || '').startsWith('取消归档'))`,
      { label: 'the unarchive button to appear' }
    );
  } catch (err) {
    // Say where we actually ended up. The two ways this fails look identical
    // from here: still on /manage with nothing selected, or the card click
    // opened the book and we are in the reader.
    const seen = await session.evaluate(
      `({ path: location.pathname, selected: document.querySelectorAll('.book-grid-item .absolute.inset-0').length, titles: [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).filter(Boolean).slice(0, 12) })`
    );
    throw new Error(`${err.message} | ${JSON.stringify(seen)}`);
  }
  const restored = await clickByTitlePrefix('取消归档');
  if (!restored.ok) throw new Error(restored.why);

  await session.evaluate(`(() => {
    const all = [...document.querySelectorAll('button')].find((b) => /全部书籍/.test(b.innerText));
    if (all) all.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 1;
  })()`);
  await session.waitFor(js`document.body.innerText.includes(${TEST_TITLE})`, {
    label: 'the book to come back to the library'
  });
  const after = await shelf();
  if (after.archivedCount) {
    throw new Error(`已归档 still shows ${after.archivedCount} after restoring`);
  }
  return 'hidden from the shelf, listed under 已归档, restored';
}

/**
 * Regression, reported 2026-08-31: during TTS a sentence at the start of a
 * paragraph occasionally scrolled the reader deep into unread text, and the
 * next sentence scrolled back.
 *
 * Cause was `scrollSentenceIntoView`'s text-node walk disagreeing with
 * `extractText()` — the space sentence indices are expressed in — so a
 * paragraph-start index resolved to an enclosing wrapper element, and
 * centring a 76042px chapter `<div>` in an 860px viewport lands anywhere.
 *
 * Both sides here are production code: the scenario asks the real locator
 * where an index lives and checks it against the real extractText() walk.
 * A drift in either one fails this.
 */
async function ttsFollowResolvesParagraphStarts(bookId) {
  await goto(`/b?id=${bookId}`, `!!document.querySelector('.book-content')`);
  await session.waitFor(laidOut(), { label: 'the book to lay out' });

  const out = await session.evaluate(`(async () => {
    const { elementForCharIndex } = await import('/src/lib/components/book-reader/char-index-locator.ts');
    const { extractText } = await import('/src/lib/components/book-reader/auto-reader-shared.ts');
    const root = document.querySelector('.book-content');
    if (!root) return { ok: false, why: 'no .book-content' };

    // Rebuild extractText()'s segment map so we know the right answer.
    const segs = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent) continue;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const text = n.textContent || '';
      if (!text.length) continue;
      segs.push({ el: parent, start: total, end: total + text.length });
      total += text.length;
    }
    if (segs.length !== 0 && total !== extractText(root).length) {
      return { ok: false, why: 'segment map disagrees with extractText itself' };
    }

    // Every element's first index — a sentence opening a paragraph lands here,
    // which is exactly where the old walk went wrong.
    const firsts = [];
    const seen = new Set();
    for (const s of segs) {
      if (seen.has(s.el)) continue;
      seen.add(s.el);
      firsts.push(s);
    }
    if (firsts.length < 20) return { ok: false, why: 'too few paragraphs to be a real check' };

    let wrong = 0;
    let firstWrong = null;
    for (const s of firsts) {
      const got = elementForCharIndex(root, s.start);
      if (got !== s.el) {
        wrong += 1;
        if (!firstWrong) firstWrong = { at: s.start, wantTag: s.el.tagName, gotTag: got ? got.tagName : 'null' };
      }
    }
    return { ok: true, checked: firsts.length, wrong, firstWrong };
  })()`);

  if (!out.ok) throw new Error(out.why);
  if (out.wrong) {
    throw new Error(
      `${out.wrong}/${out.checked} paragraph starts resolved to the wrong element ` +
        `(first: ${JSON.stringify(out.firstWrong)})`
    );
  }
  return `${out.checked} paragraph starts resolve exactly`;
}

/**
 * Regression, found while auditing the reader's index spaces after the
 * paragraph-start bug (2026-08-31).
 *
 * TTS boundaries are offsets into `extractText()`; the paginated auto-page-flip
 * feeds them to a calculator that counts `getParagraphNodes()` instead — which
 * drops `<rt>` furigana and hidden subtrees and adds gaiji images. The old
 * translation ran on the flat extracted *string*, so it could not see the
 * node-level exclusions: a paragraph with furigana translated to 19 where the
 * calculator counted 14. The error accumulates within a section, so in a
 * Japanese book the page runs further and further ahead of the voice.
 *
 * Both sides are production code, and the content shapes are the ones that
 * diverged. A drift in either implementation fails this.
 */
async function ttsCalculatorIndexAgrees() {
  const out = await session.evaluate(`(async () => {
    const { extractText } = await import('/src/lib/components/book-reader/auto-reader-shared.ts');
    const { ttsIndexToCalculatorIndex, calculatorIndexToTtsIndex } = await import(
      '/src/lib/components/book-reader/tts-calculator-index.ts'
    );
    const { getCharacterCount } = await import('/src/lib/functions/get-character-count.ts');
    const { getParagraphNodes } = await import(
      '/src/lib/components/book-reader/get-paragraph-nodes.ts'
    );

    const cases = {
      plain: '<p>吾輩は猫である。名前はまだ無い。</p>',
      furigana:
        '<p>吾輩は<ruby>猫<rt>ねこ</rt></ruby>である。<ruby>名前<rt>なまえ</rt></ruby>はまだ無い。</p>',
      hidden: '<p>見える文章。<span hidden>隠れた文章</span>また見える。</p>',
      ariaHidden: '<p>見える文章。<span aria-hidden="true">隠れた文章</span>また見える。</p>',
      withImage:
        '<p>前の段落。</p><p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p><p>後の段落。</p>'
    };

    const drifts = {};
    for (const [name, html] of Object.entries(cases)) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;';
      host.innerHTML = html;
      document.body.appendChild(host);
      const calc = getParagraphNodes(host).reduce((a, n) => a + getCharacterCount(n), 0);
      const text = extractText(host);
      drifts[name] = ttsIndexToCalculatorIndex(host, text.length) - calc;
      // The way back, used for where play starts: every calculator position
      // must land ON the next counted character — not merely after the last
      // one, which sits before its trailing 「。」 and snaps to the wrong
      // sentence.
      for (let k = 0; k < calc && !drifts[name]; k++) {
        const i = calculatorIndexToTtsIndex(host, k);
        if (ttsIndexToCalculatorIndex(host, i) !== k || ttsIndexToCalculatorIndex(host, i + 1) !== k + 1) {
          drifts[name] = 'back@' + k;
        }
      }
      host.remove();
    }
    return drifts;
  })()`);

  const off = Object.entries(out).filter(([, drift]) => drift !== 0);
  if (off.length) {
    throw new Error(
      `index spaces disagree: ${off.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}`
    );
  }
  return `${Object.keys(out).length} content shapes translate exactly`;
}

/**
 * Regression, reported 2026-08-31: an EPUB that uses a small image as its
 * footnote marker had the text after every marker start a new line.
 *
 * Tailwind's preflight sets `img { display: block }` for the whole app, which
 * is right for an illustration and wrong for a marker sitting mid-sentence.
 * The formatter tags the images that live inside a line of text and the
 * stylesheet puts those back inline; this checks the two halves still meet.
 *
 * Runs inside the opened book on purpose — the rule is scoped to the reader's
 * stylesheet, so testing it anywhere else would only prove the class name
 * exists.
 */
async function inlineImagesDoNotBreakTheLine(bookId) {
  await goto(`/b?id=${bookId}`, `!!document.querySelector('.book-content')`);

  const out = await session.evaluate(`(async () => {
    const { isInlineImage } = await import(
      '/src/lib/functions/book-data-loader/format-book-data-html.ts'
    );
    const root = document.querySelector('.book-content');
    if (!root) return { ok: false, why: 'no .book-content' };
    const D = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    const shapes = {
      bare: '前面的正文<img src="' + D + '" width="12" height="12">后面的正文继续。',
      sup: '前面的正文<sup><img src="' + D + '" width="12" height="12"></sup>后面的正文继续。',
      anchor:
        '前面的正文<a href="#n1"><img src="' + D + '" width="12" height="12"></a>后面的正文继续。',
      span:
        '前面的正文<span class="note"><img src="' + D + '" width="12" height="12"></span>后面的正文继续。'
    };

    const lines = (el) => {
      const tops = new Set();
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!(n.textContent || '').trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        tops.add(Math.round(rg.getBoundingClientRect().top));
      }
      return tops.size;
    };

    const markers = {};
    for (const [name, html] of Object.entries(shapes)) {
      const p = document.createElement('p');
      p.innerHTML = html;
      root.insertBefore(p, root.firstChild);
      const img = p.querySelector('img');
      const inline = isInlineImage(img);
      if (inline) img.classList.add('ttu-inline-img');
      markers[name] = {
        detected: inline,
        display: getComputedStyle(img).display,
        lines: lines(p)
      };
      p.remove();
    }

    // An illustration must stay block, or this "fix" would flatten every
    // picture in the book onto the text line.
    const pic = document.createElement('p');
    pic.innerHTML = '<img src="' + D + '" width="200" height="100">';
    root.insertBefore(pic, root.firstChild);
    const picImg = pic.querySelector('img');
    const illustration = {
      detected: isInlineImage(picImg),
      display: getComputedStyle(picImg).display
    };
    pic.remove();

    return { ok: true, markers, illustration };
  })()`);

  if (!out.ok) throw new Error(out.why);

  const broken = Object.entries(out.markers).filter(
    ([, m]) => !m.detected || m.display !== 'inline' || m.lines !== 1
  );
  if (broken.length) {
    throw new Error(
      `note markers still break the line: ${broken
        .map(([k, m]) => `${k}(detected=${m.detected}, display=${m.display}, lines=${m.lines})`)
        .join(', ')}`
    );
  }
  if (out.illustration.detected || out.illustration.display !== 'block') {
    throw new Error(
      `a standalone illustration was flattened: ${JSON.stringify(out.illustration)}`
    );
  }
  return `${Object.keys(out.markers).length} marker shapes stay on one line, illustrations stay block`;
}

/** SAPI, nothing selected, no saved voice position for the book. Scroll mode
 *  only — the scenarios using this put a paragraph on screen with
 *  scrollIntoView and drive the typewriter, which only exists in scroll mode.
 *  It used to set viewMode itself, so a paginated run "passed" them in
 *  scroll mode; the mode loop now simply doesn't run them in paginated. */
async function scrollModeVoiceFromScratch(bookId) {
  await session.evaluate(js`(() => {
    localStorage.setItem('ttsEngine', 'sapi');
    localStorage.setItem('ttsStartStrategy', 'selection');
    const saved = JSON.parse(localStorage.getItem('ttsPositions') || '{}');
    delete saved[${String(bookId)}];
    localStorage.setItem('ttsPositions', JSON.stringify(saved));
    return 1;
  })()`);
  await goto(
    `/b?id=${bookId}`,
    `!!document.querySelector('[title^="开始朗读"]') && document.querySelectorAll('.book-content p').length > 70`
  );
  // The reader restores the bookmark after it renders; a scroll made before
  // that is undone, and play then rightly starts at the top.
  await new Promise((r) => setTimeout(r, 1000));
}

/** Put paragraph `n` at the top of the screen, let the position catch up,
 *  and report which paragraph is actually there. */
const scrollToParagraph = (n) => `(() => {
  const p = [...document.querySelectorAll('.book-content p')]
    .find((x) => x.textContent.startsWith('第${n}段'));
  p.scrollIntoView({ block: 'start' });
  return new Promise((done) => setTimeout(() => {
    const top = [...document.querySelectorAll('.book-content p')]
      .find((x) => x.getBoundingClientRect().bottom > 0);
    done(top ? top.textContent.slice(0, 6) : null);
  }, 800));
})()`;

/** Paragraph of the sentence being spoken, as the 「第N段。」 it opens with. */
const SPOKEN_PARAGRAPH = `(() => {
  const hl = CSS.highlights && CSS.highlights.get('tts-sentence');
  if (!hl) return null;
  for (const r of hl) {
    const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const p = el && el.closest('p');
    return p ? p.textContent.slice(0, 6) : null;
  }
  return null;
})()`;

const paragraphNumber = (text) => Number((/第(\d+)段/.exec(text || '') || [])[1] || 0);
/** Like paragraphNumber, but a chapter heading counts as the paragraph it
 *  opens (the test book's 第2章 starts at 第41段) — after a jump the screen can
 *  show the heading or the line just above it, which are the same place. */
const positionOf = (text) => {
  const ch = /第(\d+)章/.exec(text || '');
  return ch ? (Number(ch[1]) - 1) * 40 + 1 : paragraphNumber(text);
};

/**
 * Regression, found 2026-10-29 while mapping where playback starts in scroll
 * mode: with nothing selected, play started well before the screen — and the
 * V key started at the first sentence of the book.
 *
 * The play button seeked to `exploredCharCount` as if it were an
 * extractText() offset; the calculator strips punctuation and whitespace, so
 * at paragraph 60 that landed 177 characters early, on a lone 「。」 that SAPI
 * failed to play (「朗读失败」). V called toggle() directly and skipped the
 * start position altogether. Both presses are checked: they are separate
 * routes into the same start.
 */
async function voiceStartsOnScreen(bookId) {
  const target = 60;
  const got = {};
  for (const [label, press] of [
    ['播放键', `document.querySelector('[title^="开始朗读"]').click()`],
    ['V 键', `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true }))`]
  ]) {
    await scrollModeVoiceFromScratch(bookId);
    const top = await session.evaluate(scrollToParagraph(target));
    if (paragraphNumber(top) !== target) {
      throw new Error(`setup: wanted 第${target}段 at the top, the screen shows ${top}`);
    }
    const out = await session.evaluate(`(() => {
      ${press};
      return new Promise((done) => {
        let tries = 0;
        const poll = setInterval(() => {
          const spoken = ${SPOKEN_PARAGRAPH};
          const failed = [...document.querySelectorAll('[role=dialog], dialog')]
            .map((d) => d.innerText).find((t) => t.includes('朗读失败'));
          if (spoken || failed || ++tries > 32) {
            clearInterval(poll);
            document.querySelector('[title^="暂停朗读"]')?.click();
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            done({ spoken, failed: failed ? failed.slice(0, 80) : null });
          }
        }, 250);
      });
    })()`);
    if (out.failed) throw new Error(`${label}: ${out.failed}`);
    if (!out.spoken) throw new Error(`${label}: the voice never started`);
    got[label] = paragraphNumber(out.spoken);
  }
  // ±1: which paragraph sits exactly at the top edge is a layout detail.
  const wrong = Object.entries(got).filter(([, at]) => Math.abs(at - target) > 1);
  if (wrong.length) {
    throw new Error(
      `screen starts at 第${target}段, ${wrong.map(([k, at]) => `${k} started at 第${at}段`).join(', ')}`
    );
  }
  return Object.entries(got).map(([k, at]) => `${k}从第${at}段起读`).join('，');
}

/**
 * Regression, found 2026-10-29: starting the typewriter while the voice was
 * reading left both running — the voice carried on through text the
 * typewriter had just hidden. Starting it with Space after any use of the
 * voice also left the voice's rate pill in the slot under the typewriter's
 * button, so − / + changed the speaking rate instead of the typing speed.
 *
 * Read and pressed in one synchronous evaluate: the typewriter resolves its
 * start position inside the keydown, so the frontier can be compared with
 * the sentence that was being spoken at that exact moment.
 */
async function typewriterTakesOverFromVoice(bookId) {
  await scrollModeVoiceFromScratch(bookId);
  await session.evaluate(scrollToParagraph(30));
  const out = await session.evaluate(`(() => {
    document.querySelector('[title^="开始朗读"]').click();
    return new Promise((done) => {
      let tries = 0;
      const poll = setInterval(() => {
        const spoken = ${SPOKEN_PARAGRAPH};
        if (!spoken && ++tries < 32) return;
        clearInterval(poll);
        if (!spoken) return done({ why: 'the voice never started' });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
        const frontier = [...document.querySelectorAll('.book-content p')]
          .find((x) => x.classList.contains('tw-block-hidden') || x.querySelector('.tw-hidden'));
        setTimeout(() => {
          const pill = (title) => {
            const b = document.querySelector('[title^="' + title + '"]');
            return b ? getComputedStyle(b.parentElement).pointerEvents : 'missing';
          };
          const res = {
            spoken,
            frontier: frontier ? frontier.textContent.slice(0, 6) : null,
            voiceStillOn: !!document.querySelector('[title^="暂停朗读"]'),
            typewriterOn: !!document.querySelector('[title^="暂停打字机"]'),
            typewriterPill: pill('减速'),
            voicePill: pill('语速')
          };
          document.querySelector('[title^="暂停打字机"]')?.click();
          document.querySelector('[title^="暂停朗读"]')?.click();
          if (window.speechSynthesis) window.speechSynthesis.cancel();
          done(res);
        }, 600);
      }, 250);
    });
  })()`);

  if (out.why) throw new Error(out.why);
  if (!out.typewriterOn) throw new Error('Space did not start the typewriter');
  if (out.voiceStillOn) throw new Error('the voice kept reading after the typewriter started');
  if (paragraphNumber(out.frontier) !== paragraphNumber(out.spoken)) {
    throw new Error(`voice was at ${out.spoken}, typewriter started at ${out.frontier}`);
  }
  if (out.typewriterPill === 'none' || out.voicePill !== 'none') {
    throw new Error(
      `pill under the typewriter: typing speed ${out.typewriterPill}, voice rate ${out.voicePill}`
    );
  }
  return `朗读停在 ${out.spoken}，打字机从同一段接上，速度胶囊归打字机`;
}

/** The paragraph the typewriter's frontier is in: the first one holding hidden text. */
const FRONTIER_PARAGRAPH = `(() => {
  const p = [...document.querySelectorAll('.book-content p')]
    .find((x) => x.classList.contains('tw-block-hidden') || x.querySelector('.tw-hidden'));
  return p ? p.textContent.slice(0, 6) : null;
})()`;

/** Press play on the voice and report the first paragraph it speaks. */
const speakAndReport = (press) => `(() => {
  ${press};
  return new Promise((done) => {
    let tries = 0;
    const poll = setInterval(() => {
      const spoken = ${SPOKEN_PARAGRAPH};
      if (!spoken && ++tries < 32) return;
      clearInterval(poll);
      document.querySelector('[title^="暂停朗读"]')?.click();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      done(spoken);
    }, 250);
  });
})()`;

const PRESS_VOICE = `document.querySelector('[title^="开始朗读"]').click()`;
const PRESS_TYPEWRITER = `document.querySelector('[title^="开始打字机"]').click()`;
const PAUSE_TYPEWRITER = `document.querySelector('[title^="暂停打字机"]')?.click()`;
const key = (code, k) =>
  `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${k}', bubbles: true }))`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Regression, found 2026-10-29: pausing the typewriter and then jumping — a
 * bookmark, the TOC, a chapter key — landed on a blank page, because
 * everything past the frontier stays hidden while paused. Pressing play there
 * then started both engines back at the old frontier, off screen: the voice
 * from the frontier it had been handed, the typewriter typing where nobody
 * was looking.
 */
async function jumpAfterTypewriterPause(bookId) {
  await scrollModeVoiceFromScratch(bookId);
  await session.evaluate(scrollToParagraph(60));
  await session.evaluate(`(() => { ${key('KeyB', 'b')}; return 1; })()`);
  await pause(500);
  await session.evaluate(scrollToParagraph(5));
  await session.evaluate(`(() => { ${PRESS_TYPEWRITER}; return 1; })()`);
  await pause(2000);
  const frontier = await session.evaluate(`(() => { ${PAUSE_TYPEWRITER}; return ${FRONTIER_PARAGRAPH}; })()`);
  await session.evaluate(`(() => { ${key('KeyR', 'r')}; return 1; })()`);
  await pause(1000);

  const landed = await session.evaluate(`(() => {
    const p = [...document.querySelectorAll('.book-content p')]
      .find((x) => x.textContent.startsWith('第60段'));
    const top = [...document.querySelectorAll('.book-content p')]
      .find((x) => x.getBoundingClientRect().bottom > 0);
    return {
      top: top ? top.textContent.slice(0, 6) : null,
      hidden: p.classList.contains('tw-block-hidden') || !!p.querySelector('.tw-hidden')
    };
  })()`);
  if (Math.abs(paragraphNumber(landed.top) - 60) > 1) {
    throw new Error(`setup: the bookmark jump landed on ${landed.top}`);
  }
  if (landed.hidden) throw new Error('jumped past the paused typewriter onto a blank page');

  const spoken = await session.evaluate(speakAndReport(PRESS_VOICE));
  if (Math.abs(paragraphNumber(spoken) - 60) > 1) {
    throw new Error(`after the jump the voice started at ${spoken} (typewriter had paused at ${frontier})`);
  }
  return `打字机停在 ${frontier}，跳到第60段正文可见，朗读从 ${spoken} 开始`;
}

/**
 * Regression, found 2026-10-29: pressing the voice while the typewriter was
 * still running started it at the top of the screen, not at the frontier —
 * the typewriter was only stopped after the voice had picked its start, so
 * only "pause first, then switch" carried the sentence over.
 */
async function voiceTakesOverFromTypewriter(bookId) {
  await scrollModeVoiceFromScratch(bookId);
  await session.evaluate(scrollToParagraph(30));
  await session.evaluate(`(() => { ${PRESS_TYPEWRITER}; return 1; })()`);
  await pause(2500);
  const out = await session.evaluate(`(() => {
    const frontier = ${FRONTIER_PARAGRAPH};
    return ${speakAndReport(PRESS_VOICE)}.then((spoken) => ({ frontier, spoken }));
  })()`);
  if (!out.spoken) throw new Error('the voice never started');
  if (paragraphNumber(out.spoken) !== paragraphNumber(out.frontier)) {
    throw new Error(`typewriter was at ${out.frontier}, the voice started at ${out.spoken}`);
  }
  return `打字机在 ${out.frontier}，直接点朗读从同一段开始`;
}

/**
 * Regression, found 2026-10-29 while fixing the start position: closing or
 * reloading the reader overwrote the saved stop point with the first sentence
 * of the book (the engine's replayed `false` read as a stop), so the next
 * session never resumed. Started from a caret clicked into the text, which the
 * typewriter ignored until the two engines shared one start rule.
 *
 * The caret is placed with a real click: synthetic events don't move the
 * selection.
 */
async function caretStartSurvivesReload(bookId) {
  await scrollModeVoiceFromScratch(bookId);
  await session.evaluate(scrollToParagraph(60));
  const at = await session.evaluate(`(() => {
    const p = [...document.querySelectorAll('.book-content p')]
      .find((x) => x.textContent.startsWith('第66段'));
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) };
  })()`);
  await session.click(at.x, at.y);
  await pause(400);
  const typed = await session.evaluate(`(() => {
    const caret = (getSelection() || {}).type;
    ${PRESS_TYPEWRITER};
    return { caret, frontier: ${FRONTIER_PARAGRAPH} };
  })()`);
  if (paragraphNumber(typed.frontier) !== 66) {
    throw new Error(`caret in 第66段 (${typed.caret}), the typewriter started at ${typed.frontier}`);
  }
  await pause(1000);
  const stopped = await session.evaluate(`(() => { ${PAUSE_TYPEWRITER}; return ${FRONTIER_PARAGRAPH}; })()`);

  await goto(
    `/b?id=${bookId}`,
    `!!document.querySelector('[title^="开始朗读"]') && document.querySelectorAll('.book-content p').length > 70`
  );
  await pause(1000);
  await session.evaluate(scrollToParagraph(60));
  const spoken = await session.evaluate(speakAndReport(`${key('KeyV', 'v')}`));
  if (paragraphNumber(spoken) !== paragraphNumber(stopped)) {
    throw new Error(`stopped at ${stopped} before the reload, the voice started at ${spoken}`);
  }
  return `光标点在第66段：打字机从那段打，停在 ${stopped}；重开后朗读从 ${spoken} 接上`;
}

/**
 * Regression (1.56.1, 10fcca6): typing in the AI drawer lost the caret
 * mid-word. The reader's window keydown treated b/r/a/d/n/m/space as
 * shortcuts even inside a textarea — ran the action (bookmark, jump,
 * chapter…) and then blurred the focused element, so the rest of the
 * sentence went nowhere. The paginated reader has its own keydown (a/d and
 * the arrows flip pages), which is why this runs in both modes and also
 * presses arrows: the page must not move while the reader types.
 *
 * The search box (Ctrl+F) is not checked here: its dialog sets
 * skipKeyDownListener, so the guard under test is never reached from it.
 */
async function aiDrawerKeepsFocusWhileTyping(bookId) {
  await goto(`/b?id=${bookId}`, READER_READY);
  await session.waitFor(laidOut(), { label: 'the book to lay out' });
  await pause(800);
  const before = { where: await session.evaluate(WHERE), saved: await savedPosition(bookId) };
  const box = await session.evaluate(`(() => {
    document.querySelector('[aria-label="显示阅读器菜单"]').click();
    return ${after(
      900,
      `(() => {
        const ai = document.querySelector('[aria-label="AI 助手"]');
        if (!ai) return { ok: false, why: 'no AI button in the reader menu' };
        ai.click();
        return new Promise(r => setTimeout(() => {
          const ta = document.querySelector('textarea');
          if (!ta) return r({ ok: false, why: 'AI drawer has no textarea' });
          const b = ta.getBoundingClientRect();
          r({ ok: true, x: b.x + b.width / 2, y: b.y + b.height / 2 });
        }, 1200));
      })()`
    )};
  })()`);
  if (!box.ok) throw new Error(box.why);
  await session.click(box.x, box.y);
  const typed = 'a bad dream, then a brave man ran';
  await session.type(typed);
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown']) await session.press(k);
  await session.type('dd');
  await pause(1500);
  const out = await session.evaluate(
    `({ tag: document.activeElement?.tagName, value: document.querySelector('textarea')?.value, where: ${WHERE} })`
  );
  const want = typed + 'dd';
  if (out.tag !== 'TEXTAREA') throw new Error(`focus went to ${out.tag}; box holds "${out.value}"`);
  if (out.value !== want) throw new Error(`box holds "${out.value}", expected "${want}"`);
  if (out.where !== before.where) throw new Error(`the page moved while typing: ${before.where} → ${out.where}`);
  const saved = await savedPosition(bookId);
  if (saved !== before.saved) throw new Error(`typing moved the saved position: ${before.saved} → ${saved}`);
  // Close the drawer: it legitimately sits over the play buttons while open,
  // and the covered-controls check runs against this page.
  await session.evaluate(`(() => {
    [...document.querySelectorAll('button[title="关闭"]')].find((b) => b.getBoundingClientRect().width > 0)?.click();
    return 1;
  })()`);
  await pause(600);
  return `${want.length} 个字符 + 方向键，焦点一直在输入框，页面没动`;
}

/**
 * Regression (acb8bbd): the TOC and reading-history drawers sat under their
 * own dimming backdrop after the dialog layer moved to z-200, so every click
 * on an entry only closed the drawer. Checked the way the user meets it: each
 * entry must be the topmost thing at its centre, and a real click on 第2章
 * must land there and close the drawer.
 */
async function tocEntriesAreClickable(bookId) {
  await forgetBookmark(bookId);
  await goto(`/b?id=${bookId}`, READER_READY);
  await session.waitFor(laidOut(), { label: 'the book to lay out' });
  await pause(800);
  await showReaderMenu('打开目录');
  await session.evaluate(`(() => {
    [...document.querySelectorAll('[title="打开目录"]')].find(e => e.getBoundingClientRect().width > 0).click();
    return 1;
  })()`);
  await pause(900);
  const entries = await session.evaluate(`(() => [...document.querySelectorAll('[title^="跳转到"]')]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map((e) => {
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { title: e.title, x, y, onTop: !!top && (e === top || e.contains(top)) };
    }))()`);
  if (entries.length < 2) throw new Error(`TOC shows ${entries.length} entries, expected 2 chapters`);
  const buried = entries.filter((e) => !e.onTop);
  if (buried.length) throw new Error(`TOC entries covered: ${buried.map((e) => e.title).join(', ')}`);

  const second = entries.find((e) => e.title.includes('第2章'));
  if (!second) throw new Error(`no 第2章 entry among ${entries.map((e) => e.title).join(', ')}`);
  await session.click(second.x, second.y);
  await pause(1500);
  const out = await session.evaluate(`({
    where: ${WHERE},
    drawerOpen: [...document.querySelectorAll('[title^="跳转到"]')].some((e) => e.getBoundingClientRect().width > 0)
  })`);
  if (out.drawerOpen) throw new Error('the drawer stayed open after clicking an entry');
  if (!/第2章|第41段/.test(out.where || '')) throw new Error(`clicked 第2章, landed on ${out.where}`);
  return `${entries.length} 个条目都在最上层，点第2章到了 ${out.where}`;
}

/**
 * Regression (8c7d1b5, and the rest of it found 2026-11-13): in scroll mode
 * the first jump after opening a book was never saved — the auto-bookmark
 * skipped the first scroll event to swallow the bookmark restore, and with no
 * bookmark to restore that event was the reader's own jump. Closing the
 * window then reopened the book where it was before. 8c7d1b5 saved 跳转 and
 * in-book search directly; the TOC and the chapter keys stayed broken.
 *
 * `location.reload()` stands in for closing the window: it skips the in-app
 * leave path, which saves on its way out and would hide the bug. The 跳转
 * dialog is not driven here — it lands through the same jumpToPosition as
 * search.
 */
async function jumpSurvivesReload(bookId) {
  await session.evaluate(`(() => {
    localStorage.setItem('autoBookmark', '1');
    localStorage.setItem('autoBookmarkTime', '1');
    localStorage.setItem('manualBookmark', '0');
    return 1;
  })()`);
  const routes = {
    书内搜索: async () => {
      await session.evaluate(`(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }));
        return 1;
      })()`);
      await session.waitFor(`!!document.querySelector('input[placeholder]:focus')`, { label: 'the search box' });
      await session.evaluate(`(() => {
        const box = document.activeElement;
        box.value = '第60段';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return 1;
      })()`);
      await pause(600);
      await session.evaluate(`(() => {
        const hit = [...document.querySelectorAll('li button')].find((b) => b.innerText.includes('第60段'));
        hit.click();
        return 1;
      })()`);
    },
    目录: async () => {
      await showReaderMenu('打开目录');
      await session.evaluate(`(() => {
        [...document.querySelectorAll('[title="打开目录"]')].find(e => e.getBoundingClientRect().width > 0).click();
        return 1;
      })()`);
      await pause(900);
      await session.evaluate(`(() => {
        [...document.querySelectorAll('[title^="跳转到"]')].find((e) => e.title.includes('第2章')).click();
        return 1;
      })()`);
    },
    // m = next chapter (n goes back).
    'm 键': async () => {
      await session.evaluate(`(() => { document.activeElement?.blur?.(); return 1; })()`);
      await session.type('m');
    }
  };
  const got = [];
  for (const [label, jump] of Object.entries(routes)) {
    await forgetBookmark(bookId);
    await goto(`/b?id=${bookId}`, READER_READY);
    await session.waitFor(laidOut(), { label: 'the book to lay out' });
    await pause(1000);
    await jump();
    await pause(2500);
    const jumped = await session.evaluate(WHERE);
    if (positionOf(jumped) < 30) {
      throw new Error(`${label}: setup — the jump went to ${jumped}`);
    }
    await session.evaluateThroughNavigation(`(() => { location.reload(); return 1; })()`);
    await session.waitFor(READER_READY, { label: 'the reader after reload' });
    await session.waitFor(laidOut(), { label: 'the book to lay out' });
    await pause(1500);
    const reopened = await session.evaluate(WHERE);
    if (Math.abs(positionOf(reopened) - positionOf(jumped)) > 1) {
      throw new Error(`${label}: jumped to ${jumped}, reopened at ${reopened}`);
    }
    got.push(`${label}→${reopened}`);
  }
  return got.join('，');
}

/**
 * Regression, found 2026-11-13: in scroll mode every open → leave of a TXT
 * book moved the saved position back one paragraph. The restore lands on a
 * paragraph's exact bottom edge, the 2/3px scroll grid at 150% scaling rounds
 * it just short, and the next save counted the paragraph above. Reopen a book
 * enough times and it walks back to the chapter start.
 */
async function positionHoldsAcrossReopen(bookId) {
  await session.evaluate(`(() => {
    localStorage.setItem('autoBookmark', '1');
    localStorage.setItem('autoBookmarkTime', '1');
    localStorage.setItem('manualBookmark', '0');
    return 1;
  })()`);
  await forgetBookmark(bookId);
  await goto(`/b?id=${bookId}`, READER_READY);
  await session.waitFor(laidOut(), { label: 'the book to lay out' });
  await pause(1000);
  if (mode === 'continuous') await session.evaluate(scrollToParagraph(25));
  else await moveAway();
  await pause(2500);
  const saved = [await savedPosition(bookId)];
  if (!saved[0]) throw new Error('setup: moving into the book saved no position');

  for (let i = 0; i < 3; i += 1) {
    await goto(`/b?id=${bookId}`, READER_READY);
    await session.waitFor(laidOut(), { label: 'the book to lay out' });
    await pause(1500);
    await showReaderMenu('返回书库');
    await session.evaluateThroughNavigation(`(() => {
      [...document.querySelectorAll('[title="返回书库"]')].find((e) => e.getBoundingClientRect().width > 0).click();
      return 1;
    })()`);
    await session.waitFor(MANAGE_READY, { label: 'the library after leaving' });
    await pause(800);
    saved.push(await savedPosition(bookId));
  }
  if (new Set(saved).size > 1) throw new Error(`saved position drifted: ${saved.join(' → ')}`);
  return `打开→离开 ×3，进度一直是 ${saved[0]}`;
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

  errors = await session.watchErrors();
  await useMode(MODES[0]);
  await warmUp('/manage', MANAGE_READY);
  bookId = await importTestBook();
  for (const m of MODES) {
    await useMode(m);
    await warmUp(`/b?id=${bookId}`, READER_READY);
  }
  console.log(`  test book imported as id ${bookId}\n`);

  // Scroll-only ones position the screen with scrollIntoView and/or drive the
  // typewriter, which the paginated reader doesn't have.
  const SCROLL = ['continuous'];
  const SCENARIOS = [
    ['书签：书籍开头设的书签能跳回去', bookmarkAtStart],
    ['朗读：正文不被隐藏、逐句高亮推进', ttsLeavesTextAlone],
    // The injected engine failure logs on purpose.
    ['朗读：引擎失败时说明原因', ttsFailureExplainsItself, { allowErrors: /synthesis-failed|Web Speech/ }],
    ['朗读：高亮一段后从那段开读', ttsStartsAtTheHighlightedPassage],
    // Three broken files are the point; the loader logs each.
    ['导入：批量失败时逐个报出文件名和原因', batchImportNamesEveryFailure, { modes: ONCE, allowErrors: /./ }],
    ['归档：从书库隐藏、在已归档里能找到、能放回来', archiveHidesAndRestores, { modes: ONCE }],
    ['朗读跟随：段落开头的位置解析不跑偏', ttsFollowResolvesParagraphStarts],
    ['朗读翻页：振假名/隐藏文本不会让字符空间漂移', ttsCalculatorIndexAgrees, { modes: ONCE }],
    ['排版：注释小图不再把后面的文字挤到下一行', inlineImagesDoNotBreakTheLine],
    ['朗读起点：没选区时从当前屏开读（播放键、V 键）', voiceStartsOnScreen, { modes: SCROLL }],
    ['打字机接管：朗读中开打字机会停掉朗读、接着那句打', typewriterTakesOverFromVoice, { modes: SCROLL }],
    ['朗读接管：打字机在跑时直接点朗读，从前沿那段开始', voiceTakesOverFromTypewriter, { modes: SCROLL }],
    ['跳转：打字机暂停后跳走不留空白页，播放从新位置开始', jumpAfterTypewriterPause, { modes: SCROLL }],
    ['续读：光标起点 → 停下 → 重开书后从停下那段接上', caretStartSurvivesReload, { modes: SCROLL }],
    ['输入框：AI 助手里打字不触发快捷键、不翻页', aiDrawerKeepsFocusWhileTyping],
    ['目录：条目在蒙版之上，点了能跳', tocEntriesAreClickable],
    ['进度：搜索/目录/m 键跳转后直接关窗也不丢', jumpSurvivesReload],
    ['进度：反复打开→离开，书签不往回退', positionHoldsAcrossReopen]
  ];

  for (const m of MODES) {
    console.log(`  — ${MODE_LABEL[m] || m} —`);
    for (const [name, run, opts = {}] of SCENARIOS) {
      const modes = opts.modes ?? MODES;
      if (modes === ONCE ? m !== MODES[0] : !modes.includes(m)) continue;
      // Each scenario starts from the user's settings, not from whatever the
      // previous one pinned: a 1s auto-bookmark left behind by one scenario
      // overwrote the next one's manual bookmark mid-test.
      await restoreSettings(snap);
      await useMode(m);
      const label = modes === ONCE ? name : `[${MODE_LABEL[m] || m}] ${name}`;
      await scenario(label, () => run(bookId), opts);
    }
  }
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
