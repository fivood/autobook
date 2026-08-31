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
      'statisticsEnabled',
      'activeFolderFilter'
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
        const names = ['data', 'bookmark', 'highlight', 'lastItem', 'archived'].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(names, 'readwrite');
        tx.objectStore('data').delete(${bookId});
        if (db.objectStoreNames.contains('bookmark')) tx.objectStore('bookmark').delete(${bookId});
        if (db.objectStoreNames.contains('lastItem')) tx.objectStore('lastItem').clear();
        // The archive is keyed by title and outlives the book row on purpose,
        // so it needs clearing explicitly or a failed run leaves the suite's
        // book hidden from the library forever.
        if (db.objectStoreNames.contains('archived')) {
          const cur = tx.objectStore('archived').openCursor();
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            if (String(c.key).startsWith(${TEST_TITLE})) c.delete();
            c.continue();
          };
        }
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
  await session.waitFor(`document.documentElement.scrollHeight > window.innerHeight * 2`, {
    label: 'the book to lay out'
  });

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
    const { ttsIndexToCalculatorIndex } = await import(
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
  await scenario('归档：从书库隐藏、在已归档里能找到、能放回来', () => archiveHidesAndRestores(bookId));
  await scenario('朗读跟随：段落开头的位置解析不跑偏', () =>
    ttsFollowResolvesParagraphStarts(bookId)
  );
  await scenario('朗读翻页：振假名/隐藏文本不会让字符空间漂移', () =>
    ttsCalculatorIndexAgrees()
  );
  await scenario('排版：注释小图不再把后面的文字挤到下一行', () =>
    inlineImagesDoNotBreakTheLine(bookId)
  );
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
