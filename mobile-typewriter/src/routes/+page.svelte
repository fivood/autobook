<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { loadFile } from '$lib/load-file';
  import type { ParsedPdf } from '$lib/load-pdf';
  import { parseText, type ParsedBook } from '$lib/parse-text';
  import { pdfPageShell } from '$lib/pdf-page-shell';
  import {
    addReadingSeconds,
    getDeviceId,
    getTodayTotal,
    pullNow,
    startSyncLoop
  } from '$lib/stats';
  import type { RemoteState } from '$lib/sync-client';
  import SyncSettings from '$lib/sync-settings.svelte';
  import { createTypewriter, type TypewriterEngine } from '$lib/typewriter';
  import {
    acquireWakeLock,
    ensureVisibilityReacquire,
    releaseWakeLock,
    wakeLockSupported
  } from '$lib/wake-lock';
  import {
    getPosition,
    hashContent,
    listRecent,
    removePosition,
    savePosition,
    type SavedPosition
  } from '$lib/persist';
  import { deleteStoredBook, getStoredBook, storeBook } from '$lib/book-store';
  import { t, tImmediate } from '$lib/i18n';

  const SPEED_KEY = 'tw-speed';
  const STOP_KEY = 'tw-stop-at-chapter';
  const RESUME_KEY = 'tw-auto-resume';
  const IMMERSIVE_KEY = 'tw-immersive';
  const READMODE_KEY = 'tw-read-mode';

  let book: ParsedBook | undefined;
  /** PDF books take a parallel state slot — they don't share the
   * typewriter engine. `bookKind` is the discriminator the template
   * branches on. */
  let pdfBook: ParsedPdf | undefined;
  let pdfPageUrls: string[] = [];
  let pdfCurrentPage = 0;
  $: bookKind = pdfBook ? 'pdf' : book ? 'text' : 'none';
  let title = '';
  let bookHash = '';
  let engine: TypewriterEngine | undefined;
  let revealed = 0;
  let total = 0;
  let playing = false;
  let chapterIdx = 0;
  let speed = 8;
  let stopAtChapter = false;
  let viewport: HTMLDivElement;
  let cursorEl: HTMLSpanElement | undefined;
  let recents: Array<SavedPosition & { hash: string }> = [];
  let busy = false;
  let error = '';
  let syncOpen = false;
  let remoteCache: RemoteState | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let todaySeconds = 0;
  // "吃饭看书" tweaks: keep screen on while playing, resume on foreground,
  // tap viewport to pause / resume, hide chrome in immersive mode.
  let autoResumeOnVisible = true;
  let wasPlayingBeforeHide = false;
  let immersive = false;
  // Immersive mode briefly shows chrome on tap, then auto-hides again.
  let chromeFlashUntil = 0;
  let chromeFlashTimer: ReturnType<typeof setTimeout> | undefined;
  $: chromeVisible = !immersive || Date.now() < chromeFlashUntil;
  /** 'typewriter' = char-by-char reveal driven by the engine (current
   * default); 'scroll' = render the whole book and let the user swipe
   * through it like a normal ebook. Stored separately from playing
   * state so flipping modes doesn't lose place. */
  let readMode: 'typewriter' | 'scroll' = 'typewriter';

  $: currentChapterTitle = book ? book.chapters[chapterIdx]?.title || '' : '';
  $: progressPct = total > 0 ? Math.round((revealed / total) * 100) : 0;

  /** Per-segment render state: reveal slice + a small lookahead of pending
   * text after the cursor so the reader can see "what's about to appear"
   * (dimmed). Limits the lookahead window so very long paragraphs don't
   * dump the entire chapter on screen. */
  $: visibleSegments = book
    ? book.segments
        .filter((seg) => seg.startChar < revealed + 1500)
        .map((seg) => {
          if (seg.endChar <= revealed) {
            return { ...seg, revealed: seg.text, pending: '', hasCursor: false };
          }
          if (seg.startChar >= revealed) {
            return {
              ...seg,
              revealed: '',
              pending: seg.text.slice(0, Math.max(0, revealed + 800 - seg.startChar)),
              hasCursor: false
            };
          }
          const cut = revealed - seg.startChar;
          return {
            ...seg,
            revealed: seg.text.slice(0, cut),
            pending: seg.text.slice(cut, cut + 800),
            hasCursor: true
          };
        })
    : [];

  let visible = true;
  let lastTickMs = 0;

  // Manual-reading activity window. PDF and scroll-mode text books have no
  // `playing` state — the reader is "active" as long as the user keeps
  // touching / scrolling. Each interaction restarts a 3-minute window;
  // when it lapses we treat the book as idle: wake lock releases (screen
  // can dim, battery survives a forgotten open PDF) and reading seconds
  // stop accumulating (an abandoned tab no longer inflates stats).
  // 3 minutes ≈ the slowest realistic dwell on one PDF page or scroll
  // viewport before the next gesture.
  const INTERACTION_IDLE_MS = 3 * 60 * 1000;
  let recentlyInteracted = true;
  let interactionIdleTimer: ReturnType<typeof setTimeout> | undefined;

  function noteInteraction() {
    recentlyInteracted = true;
    if (interactionIdleTimer) clearTimeout(interactionIdleTimer);
    interactionIdleTimer = setTimeout(() => (recentlyInteracted = false), INTERACTION_IDLE_MS);
  }

  function onVisibilityChange() {
    visible = document.visibilityState === 'visible';
    // Reset the wall-clock anchor so resuming after a long background gap
    // doesn't dump the gap into reading time.
    if (visible) {
      lastTickMs = Date.now();
      // Re-acquire screen wake lock — the browser auto-releases on hide,
      // and the user came back to a paused-looking screen otherwise.
      if (playing && wakeLockSupported()) acquireWakeLock().catch(() => {});
      // Auto-resume if we were playing when the page got hidden (user
      // checked their phone for a message and came back to the book).
      if (autoResumeOnVisible && wasPlayingBeforeHide && !playing) {
        engine?.start();
      }
      wasPlayingBeforeHide = false;
    } else {
      wasPlayingBeforeHide = playing;
    }
  }

  onMount(async () => {
    speed = Number(localStorage.getItem(SPEED_KEY)) || 8;
    stopAtChapter = localStorage.getItem(STOP_KEY) === '1';
    // Default both UX prefs ON — they're the whole point of the v1.14.2
    // mobile pass; user can flip in settings if disliked.
    const savedResume = localStorage.getItem(RESUME_KEY);
    autoResumeOnVisible = savedResume === null ? true : savedResume === '1';
    const savedImmersive = localStorage.getItem(IMMERSIVE_KEY);
    immersive = savedImmersive === '1';
    const savedMode = localStorage.getItem(READMODE_KEY);
    readMode = savedMode === 'scroll' ? 'scroll' : 'typewriter';
    recents = listRecent();
    getDeviceId();
    startSyncLoop();
    visible = document.visibilityState === 'visible';
    document.addEventListener('visibilitychange', onVisibilityChange);
    ensureVisibilityReacquire();
    // scroll doesn't bubble, so listen in capture phase to hear the inner
    // reader containers; passive keeps momentum scrolling smooth.
    window.addEventListener('pointerdown', noteInteraction, { passive: true });
    window.addEventListener('wheel', noteInteraction, { passive: true });
    window.addEventListener('keydown', noteInteraction);
    window.addEventListener('scroll', noteInteraction, { passive: true, capture: true });
    noteInteraction();
    try {
      const pulled = await pullNow();
      if (pulled) remoteCache = pulled;
    } catch {
      // offline / not configured — silent
    }
  });

  onDestroy(() => {
    engine?.destroy();
    if (tickTimer) clearInterval(tickTimer);
    if (chromeFlashTimer) clearTimeout(chromeFlashTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', noteInteraction);
      window.removeEventListener('wheel', noteInteraction);
      window.removeEventListener('keydown', noteInteraction);
      window.removeEventListener('scroll', noteInteraction, { capture: true } as EventListenerOptions);
    }
    if (interactionIdleTimer) clearTimeout(interactionIdleTimer);
    releaseWakeLock().catch(() => {});
  });

  // Wall-clock-aware tick: count actual elapsed seconds since last tick, but
  // cap each tick at 2s so a throttled background timer can't dump a 30-second
  // delta on the next firing. Only counts while the page is visible AND the
  // typewriter is actively revealing — paused or backgrounded reading doesn't
  // contribute, and a sleeping screen doesn't either.
  // Reading time accumulates while:
  //   - typewriter book is actively revealing (`playing`), or
  //   - a manually-paged book (PDF, or text in scroll mode) is open in the
  //     foreground AND the user has interacted within the idle window —
  //     otherwise a PDF left open overnight would hold the wake lock and
  //     rack up fake reading hours, while a scroll-mode text book (the
  //     hands-on reading case) previously got neither wake lock nor stats.
  // The visible + title guards still apply so a backgrounded tab doesn't
  // contribute and a no-book landing page doesn't either.
  $: manualReading = bookKind === 'pdf' || (bookKind === 'text' && readMode === 'scroll');
  $: readingActive = title !== '' && visible && (playing || (manualReading && recentlyInteracted));
  $: if (typeof window !== 'undefined') {
    if (readingActive) {
      if (!tickTimer) {
        lastTickMs = Date.now();
        tickTimer = setInterval(() => {
          const now = Date.now();
          const elapsedMs = Math.min(now - lastTickMs, 2000);
          lastTickMs = now;
          const seconds = Math.round(elapsedMs / 1000);
          if (seconds > 0) {
            addReadingSeconds(title, seconds);
            todaySeconds = getTodayTotal(title, remoteCache);
          }
        }, 1000);
      }
    } else if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  }

  $: if (title) {
    todaySeconds = getTodayTotal(title, remoteCache);
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) return tImmediate('duration.seconds', { n: seconds });
    const m = Math.floor(seconds / 60);
    if (m < 60) return tImmediate('duration.minutes', { n: m });
    const h = Math.floor(m / 60);
    return tImmediate('duration.hours', { h, m: m % 60 });
  }

  $: if (engine) engine.setSpeed(speed);
  $: if (engine) engine.setStopAtChapter(stopAtChapter);

  $: if (browser()) {
    localStorage.setItem(SPEED_KEY, String(speed));
    localStorage.setItem(STOP_KEY, stopAtChapter ? '1' : '0');
    localStorage.setItem(RESUME_KEY, autoResumeOnVisible ? '1' : '0');
    localStorage.setItem(IMMERSIVE_KEY, immersive ? '1' : '0');
    localStorage.setItem(READMODE_KEY, readMode);
  }

  // Drive the wake lock from the readingActive flag — typewriter while
  // playing, manual reading (PDF / scroll mode) while recently interacted.
  // Acquire is a no-op on browsers without the API; degrades to "screen
  // dims like today".
  $: if (browser()) {
    if (readingActive) {
      acquireWakeLock().catch(() => {});
    } else {
      releaseWakeLock().catch(() => {});
    }
  }

  function browser() {
    return typeof window !== 'undefined';
  }

  let pendingCover: string | undefined;

  let pdfLoadProgress = '';

  async function handleFile(ev: Event) {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await ingestFile(file);
    input.value = '';
  }

  /** Shared loader used by the file picker AND the drag-drop dropzone
   * AND the resume-from-recent path (which feeds back a File built
   * from a cached IDB blob). Sets busy / progress / error and
   * dispatches to PDF or text loader based on the discriminator
   * returned by loadFile. */
  async function ingestFile(file: File) {
    busy = true;
    error = '';
    pdfLoadProgress = '';
    try {
      const loaded = await loadFile(file, (loadedPages, totalPages) => {
        pdfLoadProgress = tImmediate('ingest.pdfProgress', { loaded: loadedPages, total: totalPages });
      });
      if (loaded.kind === 'pdf') {
        await openPdf(loaded.pdf);
      } else {
        pendingCover = loaded.coverDataUrl;
        await loadBook(loaded.title, loaded.text);
      }
      // Cache the original Blob so "最近阅读" can reopen without
      // re-prompting for the file. Fire-and-forget; storage quota
      // errors don't break the open flow.
      if (bookHash) {
        storeBook(bookHash, title, file, file.name).catch((err) => {
          console.warn('[book-store] save failed', err);
        });
      }
    } catch (e: any) {
      error = tImmediate('ingest.readFail', { err: e?.message || e });
    } finally {
      busy = false;
      pdfLoadProgress = '';
    }
  }

  // Drag-and-drop on the landing page. Desktop browsers / iPad with a
  // file picker can drop a book onto the window; mobile fingers fall
  // back to the existing tap-to-pick button.
  let dragOver = false;
  function onDragEnter(ev: DragEvent) {
    if (!ev.dataTransfer) return;
    if (![...ev.dataTransfer.types].includes('Files')) return;
    ev.preventDefault();
    dragOver = true;
  }
  function onDragOver(ev: DragEvent) {
    if (!ev.dataTransfer) return;
    if (![...ev.dataTransfer.types].includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(ev: DragEvent) {
    // Only clear when the cursor truly leaves the drop target — leave
    // events also fire when crossing into a child element. Check that
    // the new relatedTarget isn't inside the landing area.
    const next = ev.relatedTarget as Node | null;
    if (next && (ev.currentTarget as HTMLElement).contains(next)) return;
    dragOver = false;
  }
  async function onDrop(ev: DragEvent) {
    dragOver = false;
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    if (busy) return;
    await ingestFile(file);
  }

  async function openPdf(parsed: ParsedPdf) {
    closeAnyBook();
    pdfBook = parsed;
    title = parsed.title;
    pdfPageUrls = parsed.pages.map((p) => URL.createObjectURL(p.imageBlob));
    total = parsed.pages.length;
    bookHash = await hashContent(`pdf:${title}:${total}:${parsed.totalChars}`);
    const saved = getPosition(bookHash);
    pdfCurrentPage =
      saved?.page != null && saved.page < total
        ? saved.page
        : saved?.revealed && saved.revealed < total
        ? saved.revealed
        : 0;
    revealed = pdfCurrentPage;
    recents = listRecent();
    await tick();
    requestScrollToPdfPage(pdfCurrentPage);
  }

  /** Tear down typewriter / PDF state cleanly. Always run before
   * switching to a different book so blob URLs from the prior PDF get
   * revoked and the engine stops ticking. */
  function closeAnyBook() {
    engine?.destroy();
    engine = undefined;
    book = undefined;
    if (pdfPageUrls.length) {
      for (const u of pdfPageUrls) URL.revokeObjectURL(u);
      pdfPageUrls = [];
    }
    pdfBook = undefined;
    pdfCurrentPage = 0;
    revealed = 0;
    total = 0;
    playing = false;
  }

  async function loadBook(name: string, text: string) {
    closeAnyBook();
    const parsed = parseText(text);
    if (!parsed.totalChars) {
      error = tImmediate('ingest.noReadableContent');
      return;
    }
    title = name;
    book = parsed;
    total = parsed.totalChars;
    bookHash = await hashContent(parsed.flatText);
    const saved = getPosition(bookHash);
    revealed = saved?.revealed && saved.revealed < total ? saved.revealed : 0;
    chapterIdx = 0;

    engine = createTypewriter({ total, speed });
    engine.setStopAtChapter(stopAtChapter);
    engine.setChapterBoundaries(parsed.chapters.map((c) => c.startChar));
    engine.seek(revealed);
    engine.state.subscribe((s) => {
      revealed = s.revealed;
      total = s.total;
      playing = s.playing;
      chapterIdx = s.chapterIdx;
      persistDebounced();
      requestScrollToCursor();
    });

    recents = listRecent();
    await tick();
    requestScrollToCursor();
  }

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  function persistDebounced() {
    if (!bookHash) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const existing = getPosition(bookHash);
      // Cover from this session beats any older sniff; otherwise keep the
      // previously saved cover so re-uploading without the original file
      // doesn't drop the thumbnail.
      const coverDataUrl =
        (pdfBook?.coverDataUrl as string | undefined) ||
        pendingCover ||
        existing?.coverDataUrl;
      if (pdfBook) {
        savePosition(bookHash, {
          title,
          revealed: pdfCurrentPage,
          total: pdfBook.pages.length,
          updatedAt: Date.now(),
          preview: tImmediate('ingest.pdfPreview', { n: pdfBook.pages.length }),
          kind: 'pdf',
          page: pdfCurrentPage,
          ...(coverDataUrl ? { coverDataUrl } : {})
        });
      } else if (book) {
        savePosition(bookHash, {
          title,
          revealed,
          total,
          updatedAt: Date.now(),
          preview: book.flatText.slice(0, 60).replace(/\n/g, ' '),
          kind: 'text',
          ...(coverDataUrl ? { coverDataUrl } : {})
        });
      }
      recents = listRecent();
    }, 400);
  }

  let scrollRaf = 0;
  function requestScrollToCursor() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!viewport || !cursorEl) return;
      const cursorRect = cursorEl.getBoundingClientRect();
      const vpRect = viewport.getBoundingClientRect();
      const targetTop = cursorRect.top - vpRect.top + viewport.scrollTop;
      const desired = targetTop - viewport.clientHeight * 0.55;
      viewport.scrollTo({ top: Math.max(0, desired), behavior: 'smooth' });
    });
  }

  /** Scroll the PDF viewport so the requested page sits at the top of
   * the visible area. Used both on initial resume and when jumping via
   * the page indicator. */
  function requestScrollToPdfPage(idx: number) {
    requestAnimationFrame(() => {
      if (!viewport) return;
      const target = viewport.querySelector(`[data-pdf-page-index="${idx}"]`);
      if (!target) return;
      const r = (target as HTMLElement).getBoundingClientRect();
      const vp = viewport.getBoundingClientRect();
      const top = r.top - vp.top + viewport.scrollTop;
      viewport.scrollTo({ top: Math.max(0, top - 8), behavior: 'instant' as ScrollBehavior });
    });
  }

  /** Update `pdfCurrentPage` based on which page wrapper sits closest
   * to the top of the viewport. Throttled via rAF so a continuous
   * scroll doesn't fire 60 times per second. */
  let pdfScrollRaf = 0;
  function onPdfScroll() {
    if (!pdfBook || pdfScrollRaf) return;
    pdfScrollRaf = requestAnimationFrame(() => {
      pdfScrollRaf = 0;
      if (!viewport || !pdfBook) return;
      const wraps = viewport.querySelectorAll<HTMLElement>('[data-pdf-page-index]');
      const vpTop = viewport.scrollTop;
      let best = 0;
      let bestDist = Infinity;
      for (const w of wraps) {
        const dist = Math.abs(w.offsetTop - vpTop);
        if (dist < bestDist) {
          bestDist = dist;
          best = +(w.dataset.pdfPageIndex || 0);
        }
      }
      if (best !== pdfCurrentPage) {
        pdfCurrentPage = best;
        revealed = best;
        persistDebounced();
      }
    });
  }

  function togglePlay() {
    engine?.toggle();
  }

  function toggleReadMode() {
    if (!book) {
      readMode = readMode === 'typewriter' ? 'scroll' : 'typewriter';
      return;
    }
    if (readMode === 'typewriter') {
      // Going to scroll. Stop the typewriter, freeze position, scroll
      // the rendered viewport so the current `revealed` is near the top.
      engine?.stop();
      readMode = 'scroll';
      requestAnimationFrame(() => requestScrollToRevealed());
    } else {
      // Going back to typewriter. Use the scroll-derived `revealed` as
      // the engine's new starting point so the cursor lands where the
      // eye left off.
      readMode = 'typewriter';
      engine?.seek(revealed);
      requestAnimationFrame(() => requestScrollToCursor());
    }
  }

  /** Scroll the text viewport so the segment containing `revealed`
   * sits near the top — used when flipping into scroll mode so the
   * user doesn't lose place. */
  function requestScrollToRevealed() {
    if (!viewport || !book) return;
    // Find the first segment whose endChar > revealed (i.e. the one
    // currently being read), then look up its rendered element by data
    // attribute and bring it into view.
    const idx = book.segments.findIndex((seg) => seg.endChar > revealed);
    if (idx < 0) return;
    const startChar = book.segments[idx].startChar;
    const target = viewport.querySelector(`[data-seg-start="${startChar}"]`);
    if (!target) return;
    const r = (target as HTMLElement).getBoundingClientRect();
    const vp = viewport.getBoundingClientRect();
    const top = r.top - vp.top + viewport.scrollTop;
    viewport.scrollTo({ top: Math.max(0, top - 16), behavior: 'instant' as ScrollBehavior });
  }

  /** Recompute `revealed` from current scroll position in scroll mode.
   * Finds the segment whose rendered top crossed the viewport top and
   * estimates how many chars into it the reader has likely got. */
  let scrollModeRaf = 0;
  function onScrollModeScroll() {
    if (readMode !== 'scroll' || !book || scrollModeRaf) return;
    scrollModeRaf = requestAnimationFrame(() => {
      scrollModeRaf = 0;
      if (!viewport || !book) return;
      const vpTop = viewport.scrollTop;
      const wraps = viewport.querySelectorAll<HTMLElement>('[data-seg-start]');
      let bestSeg: HTMLElement | undefined;
      for (const w of wraps) {
        if (w.offsetTop > vpTop + 12) break;
        bestSeg = w;
      }
      if (!bestSeg) return;
      const startChar = +(bestSeg.dataset.segStart || 0);
      // Approximate how far into this segment the reader is. The
      // segment's rendered height maps linearly to its char length;
      // we sample how much of the segment is above the viewport top.
      const segHeight = bestSeg.getBoundingClientRect().height || 1;
      const segOffsetIntoView = Math.max(0, vpTop - bestSeg.offsetTop);
      const seg = book.segments.find((s) => s.startChar === startChar);
      const segChars = seg ? seg.text.length : 0;
      const into = Math.floor((segOffsetIntoView / segHeight) * segChars);
      const nextRevealed = Math.min(total, startChar + into);
      if (nextRevealed !== revealed) {
        revealed = nextRevealed;
        if (book && book.chapters.length) {
          chapterIdx = book.chapters.reduce(
            (acc, ch, i) => (ch.startChar <= revealed ? i : acc),
            0
          );
        }
        persistDebounced();
      }
    });
  }

  // Tap-anywhere-on-reading-area toggle. Greasy / one-handed friendly —
  // small play button bottom-center is too far to thumb-reach. We detect
  // a "tap" as a pointerdown→up within 8px movement and 300ms; anything
  // longer or further is treated as a scroll gesture and lets the
  // browser handle it.
  let tapDownX = 0;
  let tapDownY = 0;
  let tapDownT = 0;
  let tapDownScrollTop = 0;
  function onViewportPointerDown(ev: PointerEvent) {
    tapDownX = ev.clientX;
    tapDownY = ev.clientY;
    tapDownT = ev.timeStamp;
    tapDownScrollTop = viewport?.scrollTop ?? 0;
  }
  function onViewportPointerUp(ev: PointerEvent) {
    const dx = Math.abs(ev.clientX - tapDownX);
    const dy = Math.abs(ev.clientY - tapDownY);
    const dt = ev.timeStamp - tapDownT;
    const scrollMoved = Math.abs((viewport?.scrollTop ?? 0) - tapDownScrollTop) > 4;
    if (dx > 10 || dy > 10 || dt > 350 || scrollMoved) return;
    // In immersive mode the first tap reveals chrome instead of toggling
    // play. Lets the user find the speed / close buttons without
    // turning immersive off.
    if (immersive && !chromeVisible) {
      flashChrome();
      return;
    }
    // Manual-reading surfaces (PDF, scroll mode) have no play/pause
    // concept — tap is only for the immersive chrome-flash above.
    // Selection still works because the text layer spans capture
    // pointer events before bubbling here.
    if (pdfBook || readMode === 'scroll') return;
    togglePlay();
  }

  function flashChrome() {
    chromeFlashUntil = Date.now() + 2400;
    clearTimeout(chromeFlashTimer);
    chromeFlashTimer = setTimeout(() => {
      chromeFlashUntil = 0;
    }, 2500);
  }

  function toggleImmersive() {
    immersive = !immersive;
    if (!immersive) chromeFlashUntil = 0;
  }

  function bumpSpeed(delta: number) {
    speed = Math.max(1, Math.min(60, speed + delta));
  }

  async function resumeFromRecent(item: SavedPosition & { hash: string }) {
    // Cache hit: re-ingest from the stored Blob — instant resume, no
    // file picker.
    try {
      const stored = await getStoredBook(item.hash);
      if (stored) {
        const file = new File([stored.blob], stored.fileName, {
          type: stored.blob.type
        });
        await ingestFile(file);
        return;
      }
    } catch (err) {
      console.warn('[book-store] read failed, falling back to picker', err);
    }
    // Cache miss (legacy recents from before book-store landed, or
    // IDB unavailable): fall back to asking for the file.
    busy = true;
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept =
        item.kind === 'pdf' ? '.pdf' : '.txt,.epub,.md,.markdown,.pdf';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const loaded = await loadFile(file, (p, t) => {
            pdfLoadProgress = tImmediate('ingest.pdfProgress', { loaded: p, total: t });
          });
          if (loaded.kind === 'pdf') {
            const h = await hashContent(
              `pdf:${loaded.pdf.title}:${loaded.pdf.pages.length}:${loaded.pdf.totalChars}`
            );
            if (h !== item.hash) {
              error = tImmediate('ingest.hashMismatch');
              return;
            }
            await openPdf(loaded.pdf);
          } else {
            const h = await hashContent(parseText(loaded.text).flatText);
            if (h !== item.hash) {
              error = tImmediate('ingest.hashMismatch');
              return;
            }
            await loadBook(item.title, loaded.text);
          }
        } catch (e: any) {
          error = tImmediate('ingest.readFail', { err: e?.message || e });
        }
      };
      input.click();
    } finally {
      busy = false;
    }
  }

  function deleteRecent(hash: string) {
    removePosition(hash);
    deleteStoredBook(hash).catch(() => {
      // best-effort cleanup; if IDB fails we just orphan a blob
    });
    recents = listRecent();
  }

  function jumpToChapter(idx: number) {
    if (!book || !engine) return;
    engine.seek(book.chapters[idx].startChar);
  }

  function restart() {
    engine?.seek(0);
  }
</script>

<svelte:head>
  <title>{bookKind !== 'none' ? `${title} · AutoBook` : 'AutoBook'}</title>
</svelte:head>

{#if bookKind === 'none'}
  <main
    class="landing"
    class:drag-over={dragOver}
    on:dragenter={onDragEnter}
    on:dragover={onDragOver}
    on:dragleave={onDragLeave}
    on:drop={onDrop}
    role="region"
    aria-label={$t('landing.dropAria')}
  >
    {#if dragOver}
      <div class="drop-hint">{$t('landing.dropHint')}</div>
    {/if}
    <h1>AutoBook</h1>
    <p class="lead">{$t('landing.lead')}</p>
    <p class="lead-sub">{$t('landing.leadSub')}</p>

    <label class="upload">
      <input
        type="file"
        accept=".txt,.epub,.md,.markdown,.pdf"
        on:change={handleFile}
        disabled={busy}
      />
      <span>{busy ? (pdfLoadProgress || $t('landing.loading')) : $t('landing.pickFile')}</span>
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if recents.length}
      <section class="recents">
        <h2>{$t('landing.recentTitle')}</h2>
        <ul>
          {#each recents as r (r.hash)}
            <li>
              <button class="recent" on:click={() => resumeFromRecent(r)}>
                {#if r.coverDataUrl}
                  <img class="recent-cover" src={r.coverDataUrl} alt="" loading="lazy" />
                {:else}
                  <div class="recent-cover placeholder">📖</div>
                {/if}
                <div class="recent-text">
                  <div class="recent-title">{r.title}</div>
                  <div class="recent-meta">
                    {#if r.kind === 'pdf'}
                      {$t('landing.recentPagesPdf', { page: (r.page ?? r.revealed) + 1, total: r.total })}
                    {:else}
                      {$t('landing.recentPct', { pct: Math.round((r.revealed / r.total) * 100), preview: r.preview })}
                    {/if}
                  </div>
                </div>
              </button>
              <button class="recent-del" title={$t('landing.recentDelete')} on:click={() => deleteRecent(r.hash)}>×</button>
            </li>
          {/each}
        </ul>
        <p class="hint">{$t('landing.recentHint')}</p>
      </section>
    {/if}

    <footer>
      <button class="link" on:click={() => (syncOpen = true)}>{$t('landing.syncOpen')}</button>
      <p>{@html $t('landing.desktopFullLink', { link: '<a href="https://github.com/fivood/autobook/releases/latest" rel="noopener">GitHub Releases</a>' })}</p>
    </footer>
  </main>
{:else}
  <div class="reader" class:immersive class:chrome-hidden={!chromeVisible}>
    <header class="topbar">
      <button class="ghost" on:click={closeAnyBook}>{$t('reader.close')}</button>
      <div class="header-title">
        <div class="book-title">{title}</div>
        {#if bookKind === 'text' && currentChapterTitle}
          <div class="chapter-title">{currentChapterTitle}</div>
        {/if}
      </div>
      <button
        class="ghost immersive-toggle"
        on:click={toggleImmersive}
        title={immersive ? $t('reader.immersiveOff') : $t('reader.immersiveOn')}
        aria-label={immersive ? $t('reader.immersiveOff') : $t('reader.immersiveOn')}
      >{immersive ? '◳' : '◰'}</button>
      <span class="progress-tag" title={$t('reader.progressAria')}>
        {#if bookKind === 'pdf'}
          {$t('reader.pdfProgress', { cur: pdfCurrentPage + 1, total, duration: formatDuration(todaySeconds) })}
        {:else}
          {$t('reader.textProgress', { pct: progressPct, duration: formatDuration(todaySeconds) })}
        {/if}
      </span>
    </header>

    {#if bookKind === 'pdf' && pdfBook}
      <div
        class="viewport pdf-viewport"
        bind:this={viewport}
        on:scroll={onPdfScroll}
        on:pointerdown={onViewportPointerDown}
        on:pointerup={onViewportPointerUp}
        use:pdfPageShell
      >
        {#each pdfBook.pages as page, i (i)}
          <div
            class="pdf-page-wrap"
            data-pdf-page-index={i}
          >
            <div
              class="pdf-page-shell"
              style:aspect-ratio="{page.width} / {page.height}"
              data-page-w={page.width}
              data-page-h={page.height}
            >
              <img
                src={pdfPageUrls[i]}
                alt={$t('pdf.alt', { n: i + 1 })}
                loading="lazy"
                decoding="async"
                class="pdf-page-img"
              />
              {#if page.textHtml}
                <div
                  class="pdf-text-layer"
                  data-page-w={page.width}
                  data-page-h={page.height}
                >{@html page.textHtml}</div>
              {/if}
            </div>
            <div class="pdf-page-label">{i + 1} / {total}</div>
          </div>
        {/each}
      </div>
    {:else if readMode === 'scroll' && book}
      <!-- Scroll mode: render the whole book at normal opacity, let the
           user swipe through it. revealed position tracked by which
           segment sits at the viewport top. -->
      <div
        class="viewport scroll-viewport"
        bind:this={viewport}
        on:scroll={onScrollModeScroll}
        on:pointerdown={onViewportPointerDown}
        on:pointerup={onViewportPointerUp}
      >
        <div class="page">
          {#each book.segments as seg (seg.startChar)}
            {#if seg.type === 'h2'}
              <h2 class="ch-title" data-seg-start={seg.startChar}>{seg.text}</h2>
            {:else}
              <p class="ch-para" data-seg-start={seg.startChar}>{seg.text}</p>
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div
        class="viewport"
        bind:this={viewport}
        on:pointerdown={onViewportPointerDown}
        on:pointerup={onViewportPointerUp}
      >
        <div class="page">
          {#each visibleSegments as seg (seg.startChar)}
            {#if seg.type === 'h2'}
              <h2 class="ch-title">
                <span class="revealed">{seg.revealed}</span>{#if seg.hasCursor}<span
                    class="cursor"
                    bind:this={cursorEl}
                    class:cursor-on={playing}
                  />{/if}{#if seg.pending}<span class="pending">{seg.pending}</span>{/if}
              </h2>
            {:else}
              <p class="ch-para">
                <span class="revealed">{seg.revealed}</span>{#if seg.hasCursor}<span
                    class="cursor"
                    bind:this={cursorEl}
                    class:cursor-on={playing}
                  />{/if}{#if seg.pending}<span class="pending">{seg.pending}</span>{/if}
              </p>
            {/if}
          {/each}
        </div>
      </div>
    {/if}

    <!-- Always-visible reading progress strip. 2px high, no chrome. -->
    <div class="progress-strip" aria-hidden="true">
      <div class="progress-fill" style:width="{progressPct}%" />
    </div>

    {#if bookKind === 'pdf' && pdfBook}
      <div class="controls pdf-controls">
        <button
          class="chip"
          on:click={() => requestScrollToPdfPage(Math.max(0, pdfCurrentPage - 1))}
          disabled={pdfCurrentPage <= 0}
          aria-label={$t('pdf.prevPage')}
        >‹</button>
        <span class="speed">{$t('pdf.pageOf', { cur: pdfCurrentPage + 1, total })}</span>
        <button
          class="chip"
          on:click={() => requestScrollToPdfPage(Math.min(total - 1, pdfCurrentPage + 1))}
          disabled={pdfCurrentPage >= total - 1}
          aria-label={$t('pdf.nextPage')}
        >›</button>
        <label class="row stop-at-chapter">
          <input type="checkbox" bind:checked={autoResumeOnVisible} />
          <span title={$t('pdf.resumeTooltip')}>{$t('pdf.resume')}</span>
        </label>
      </div>
    {:else if book && readMode === 'scroll'}
      <!-- Scroll mode: no play / speed / 章止 — those only mean
           anything for the typewriter engine. Keep the mode toggle
           and 续读 so the user can flip back or carry over. -->
      <div class="controls">
        <button
          class="chip mode-chip"
          on:click={toggleReadMode}
          title={$t('scroll.toTypewriter')}
          aria-label={$t('scroll.toTypewriter')}
        >
          <!-- Typewriter glyph: top "paper sheet" + keyboard body with
               three dots representing keys / chars typed -->
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <rect x="7" y="3" width="10" height="5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <rect x="3" y="9" width="18" height="10" rx="1.6"/>
            <circle cx="8" cy="14" r="1.1" fill="var(--chip-bg)"/>
            <circle cx="12" cy="14" r="1.1" fill="var(--chip-bg)"/>
            <circle cx="16" cy="14" r="1.1" fill="var(--chip-bg)"/>
          </svg>
        </button>
        <span class="speed">{$t('scroll.label')}</span>
        <label class="row stop-at-chapter">
          <input type="checkbox" bind:checked={autoResumeOnVisible} />
          <span title={$t('pdf.resumeTooltip')}>{$t('pdf.resume')}</span>
        </label>
      </div>
    {:else if book}
      <div class="controls">
        <div class="row">
          <button class="chip" on:click={() => bumpSpeed(-1)}>−</button>
          <span class="speed">{$t('typewriter.speedUnit', { n: speed })}</span>
          <button class="chip" on:click={() => bumpSpeed(1)}>+</button>
        </div>
        <button class="play" on:click={togglePlay} aria-label={playing ? $t('typewriter.pause') : $t('typewriter.play')}>
          {#if playing}
            <svg viewBox="0 0 24 24" width="32" height="32"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="32" height="32"><path d="M7 5v14l12-7L7 5z"/></svg>
          {/if}
        </button>
        <button
          class="chip mode-chip"
          on:click={toggleReadMode}
          title={$t('typewriter.toScroll')}
          aria-label={$t('typewriter.toScroll')}
        >
          <!-- Scroll glyph: vertical double-headed arrow (up + down) +
               three short content lines suggesting "scroll through" -->
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M12 2 L8 7 H11 V17 H8 L12 22 L16 17 H13 V7 H16 Z"/>
          </svg>
        </button>
        <label class="row stop-at-chapter">
          <input type="checkbox" bind:checked={autoResumeOnVisible} />
          <span title={$t('typewriter.resumeTooltip')}>{$t('typewriter.resume')}</span>
        </label>
        <label class="row stop-at-chapter">
          <input type="checkbox" bind:checked={stopAtChapter} />
          <span>{$t('typewriter.chapterStop')}</span>
        </label>
      </div>

      {#if book.chapters.length > 1}
        <details class="toc">
          <summary>{$t('typewriter.tocSummary', { n: book.chapters.length })}</summary>
          <ul>
            {#each book.chapters as ch, i (i)}
              <li>
                <button class:active={i === chapterIdx} on:click={() => jumpToChapter(i)}>
                  {ch.title || $t('typewriter.untitledChapter', { n: i + 1 })}
                </button>
              </li>
            {/each}
          </ul>
          <button class="restart" on:click={restart}>{$t('typewriter.restart')}</button>
        </details>
      {/if}
    {/if}
    <button class="sync-fab" title={$t('landing.syncFab')} on:click={() => (syncOpen = true)}>⇅</button>
  </div>
{/if}

{#if syncOpen}
  <SyncSettings on:close={() => { syncOpen = false; pullNow().then((r) => { if (r) remoteCache = r; }).catch(() => {}); }} />
{/if}

<style>
  .landing {
    max-width: 480px;
    margin: 0 auto;
    padding: 12vh 1.5rem 4rem;
    text-align: center;
    position: relative;
    min-height: 70vh;
  }
  .landing.drag-over {
    outline: 2px dashed var(--accent);
    outline-offset: -16px;
    border-radius: 12px;
  }
  /* Big "drop to import" hint that takes over the landing area while
     the user is mid-drag. Pointer-events:none lets the actual drop
     event reach the landing container, not this overlay. */
  .drop-hint {
    position: absolute;
    inset: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 85%, var(--accent));
    color: var(--accent-text);
    border-radius: 12px;
    font-size: 1.25rem;
    font-weight: 600;
    z-index: 10;
    pointer-events: none;
  }
  .lead-sub {
    margin: -1rem 0 1.5rem;
    color: var(--fg-dim);
    font-size: 0.85rem;
  }
  @media (hover: none) and (pointer: coarse) {
    /* Mobile / touch — hide the "拖文件进来" hint, just shows the picker. */
    .lead-sub { display: none; }
  }
  .landing h1 {
    margin: 0 0 0.5rem;
    font-size: 2rem;
    letter-spacing: 0.03em;
  }
  .lead {
    margin: 0 0 2rem;
    color: var(--fg-dim);
    line-height: 1.6;
  }
  .upload {
    display: inline-block;
    padding: 0.9rem 2rem;
    background: var(--accent);
    color: var(--accent-text);
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
  }
  .upload input {
    display: none;
  }
  .error {
    color: #c64a4a;
    margin-top: 1rem;
  }
  .recents {
    margin-top: 3rem;
    text-align: left;
  }
  .recents h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 0.5rem;
  }
  .recents ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .recents li {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
    min-width: 0;
  }
  .recent {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: stretch;
    gap: 0.7rem;
    text-align: left;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.6rem;
    overflow: hidden;
  }
  .recent-cover {
    flex: 0 0 auto;
    width: 2.6rem;
    height: 3.6rem;
    object-fit: cover;
    border-radius: 0.25rem;
    background: var(--chip-bg);
  }
  .recent-cover.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    color: var(--chip-text);
    opacity: 0.7;
  }
  .recent-text {
    flex: 1 1 0;
    min-width: 0;
  }
  .recent-title {
    font-weight: 600;
    word-break: break-word;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .recent-meta {
    font-size: 0.8rem;
    color: var(--fg-dim);
    margin-top: 0.2rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-del {
    flex: 0 0 auto;
    padding: 0 0.8rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.6rem;
    color: var(--fg-dim);
    font-size: 1.2rem;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--fg-dim);
    margin-top: 0.6rem;
  }
  footer {
    margin-top: 3rem;
    font-size: 0.78rem;
    color: var(--fg-dim);
  }
  footer a {
    color: inherit;
  }

  .reader {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    position: relative;
  }
  /* Immersive: top / bottom bars collapse to zero height + zero opacity
     so the viewport gets the full screen. A short fade keeps tap-to-flash
     from feeling jarring. */
  .reader.chrome-hidden .topbar,
  .reader.chrome-hidden .controls,
  .reader.chrome-hidden .toc,
  .reader.chrome-hidden .sync-fab {
    opacity: 0;
    pointer-events: none;
    transform: translateY(var(--chrome-shift, 0));
    transition: opacity 200ms ease, transform 200ms ease;
  }
  .reader.chrome-hidden .topbar { --chrome-shift: -100%; }
  .reader.chrome-hidden .controls { --chrome-shift: 100%; }
  .reader .topbar,
  .reader .controls {
    transition: opacity 180ms ease, transform 180ms ease;
  }
  .immersive-toggle {
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.3rem 0.5rem;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  .ghost {
    padding: 0.4rem 0.6rem;
    font-size: 0.95rem;
  }
  .link {
    display: block;
    margin: 0 0 0.6rem;
    padding: 0;
    color: inherit;
    text-decoration: underline;
    opacity: 0.7;
    font-size: 0.78rem;
  }
  .header-title {
    flex: 1;
    overflow: hidden;
  }
  .book-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chapter-title {
    font-size: 0.78rem;
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .progress-tag {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    color: var(--fg-dim);
  }

  .viewport {
    flex: 1;
    overflow-y: auto;
    padding: 1.4rem 1.2rem 60vh;
    line-height: 2;
    font-size: 1.15rem;
    -webkit-overflow-scrolling: touch;
    /* Tap-to-toggle picks up clicks but text selection is unlikely in the
       reveal area (only revealed text is selectable normal; pending text
       has opacity 0.12 and won't normally be selected mid-reveal). */
    user-select: none;
    -webkit-user-select: none;
  }
  /* iPad / large screen: bump base font + tighten line-height so a
     dinner-table iPad doesn't feel like reading a margin. */
  @media (min-width: 720px) {
    .viewport { font-size: 1.45rem; line-height: 1.95; padding: 2rem 2.5rem 60vh; }
    .page { max-width: 42em; }
  }
  @media (min-width: 1024px) {
    .viewport { font-size: 1.6rem; padding: 2.5rem 3rem 60vh; }
    .page { max-width: 46em; }
  }
  /* Scroll mode: full opacity text, bottom padding tighter than
     typewriter (no 60vh chase room). User-select on so they can copy
     a quote. */
  .scroll-viewport {
    padding: 1.4rem 1.2rem 2rem;
    user-select: text;
    -webkit-user-select: text;
  }
  /* Mode chips: round like the speed +/- chips so they fit the same
     visual rhythm. SVG icons inside are sized 20×20, color inherits
     from chip-text. */
  .mode-chip {
    padding: 0;
  }
  .mode-chip svg {
    display: block;
  }

  /* PDF reader: each page wrapped in a shell that holds the rendered
     JPEG plus the transparent text-layer overlay. aspect-ratio keeps
     the shell sized correctly before the img loads (no jumpy reflow
     on lazy decode). */
  .pdf-viewport {
    padding: 0.6rem 0.5rem 60vh;
    line-height: 1; /* avoid extra space around image lines */
  }
  .pdf-page-wrap {
    max-width: 900px;
    margin: 0 auto 0.6rem;
  }
  .pdf-page-shell {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  }
  .pdf-page-shell > img.pdf-page-img {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Text layer: scaled via CSS variable so the per-span px coords stay
     aligned with the visible image at any container width. The page
     wrapper sets --pdf-scale-factor when the image loads (see action
     below). */
  .pdf-text-layer {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    transform: scale(var(--pdf-scale-factor, 1));
    pointer-events: none;
    line-height: 1;
    font-family: serif;
  }
  .pdf-text-layer > :global(span) {
    position: absolute;
    color: transparent;
    white-space: pre;
    transform-origin: 0 0;
    pointer-events: auto;
    cursor: text;
    user-select: text;
  }
  .pdf-text-layer > :global(span::selection) {
    background: rgba(0, 110, 255, 0.32);
    color: transparent;
  }
  .pdf-page-label {
    text-align: center;
    font-size: 0.72rem;
    opacity: 0.5;
    margin: 0.25rem 0 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  .pdf-controls {
    justify-content: space-between;
  }
  .pdf-controls .chip {
    width: 2.4rem;
    height: 2.4rem;
    font-size: 1.2rem;
  }
  .pdf-controls .chip:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* 2px-tall progress strip pinned above the controls bar. Always
     visible even in immersive mode so you can side-eye remaining
     progress while eating. */
  .progress-strip {
    height: 2px;
    background: rgba(127, 127, 127, 0.15);
    flex-shrink: 0;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 200ms linear;
  }
  .reader.chrome-hidden .progress-strip {
    /* In immersive, keep the strip but make it subtle. */
    opacity: 0.65;
  }
  .page {
    max-width: 36em;
    margin: 0 auto;
    word-break: break-word;
  }
  .ch-title {
    margin: 2.2em 0 1em;
    font-size: 1.35em;
    font-weight: 600;
    line-height: 1.4;
    text-align: center;
    letter-spacing: 0.05em;
  }
  .ch-title:first-child {
    margin-top: 0.5em;
  }
  .ch-para {
    margin: 0 0 1em;
    text-indent: 2em;
    white-space: pre-wrap;
  }
  .pending {
    opacity: 0.12;
  }
  .cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    margin: 0 1px;
    vertical-align: -0.15em;
    background: var(--accent);
    opacity: 0;
  }
  .cursor-on {
    opacity: 0.85;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.6rem 1rem;
    background: var(--bg);
    border-top: 1px solid rgba(0, 0, 0, 0.08);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--chip-text);
    font-size: 1.1rem;
  }
  .speed {
    min-width: 4.5em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.2);
  }
  .play svg {
    fill: currentColor;
  }
  .stop-at-chapter {
    font-size: 0.8rem;
    color: var(--fg-dim);
  }

  .toc {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(env(safe-area-inset-bottom) + 5.5rem);
    max-width: 88vw;
    max-height: 60vh;
    overflow-y: auto;
    padding: 0.6rem 1rem;
    background: var(--bg);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 0.8rem;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
    font-size: 0.85rem;
  }
  .toc summary {
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .toc ul {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 40vh;
    overflow-y: auto;
  }
  .toc li button {
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .toc li button.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  .restart {
    margin-top: 0.6rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.4rem;
    font-size: 0.78rem;
  }
</style>
