<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { loadFile } from '$lib/load-file';
  import { parseText, type ParsedBook } from '$lib/parse-text';
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
    getPosition,
    hashContent,
    listRecent,
    removePosition,
    savePosition,
    type SavedPosition
  } from '$lib/persist';

  const SPEED_KEY = 'tw-speed';
  const STOP_KEY = 'tw-stop-at-chapter';

  let book: ParsedBook | undefined;
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

  $: revealedText = book ? book.flatText.slice(0, revealed) : '';
  $: pendingText = book ? book.flatText.slice(revealed, revealed + 800) : '';
  $: currentChapterTitle = book ? book.chapters[chapterIdx]?.title || '' : '';
  $: progressPct = total > 0 ? Math.round((revealed / total) * 100) : 0;

  let visible = true;
  let lastTickMs = 0;

  function onVisibilityChange() {
    visible = document.visibilityState === 'visible';
    // Reset the wall-clock anchor so resuming after a long background gap
    // doesn't dump the gap into reading time.
    if (visible) lastTickMs = Date.now();
  }

  onMount(async () => {
    speed = Number(localStorage.getItem(SPEED_KEY)) || 8;
    stopAtChapter = localStorage.getItem(STOP_KEY) === '1';
    recents = listRecent();
    getDeviceId();
    startSyncLoop();
    visible = document.visibilityState === 'visible';
    document.addEventListener('visibilitychange', onVisibilityChange);
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  // Wall-clock-aware tick: count actual elapsed seconds since last tick, but
  // cap each tick at 2s so a throttled background timer can't dump a 30-second
  // delta on the next firing. Only counts while the page is visible AND the
  // typewriter is actively revealing — paused or backgrounded reading doesn't
  // contribute, and a sleeping screen doesn't either.
  $: if (typeof window !== 'undefined') {
    if (playing && title && visible) {
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
    if (seconds < 60) return `${seconds} 秒`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m} 分`;
    const h = Math.floor(m / 60);
    return `${h} 时 ${m % 60} 分`;
  }

  $: if (engine) engine.setSpeed(speed);
  $: if (engine) engine.setStopAtChapter(stopAtChapter);

  $: if (browser()) {
    localStorage.setItem(SPEED_KEY, String(speed));
    localStorage.setItem(STOP_KEY, stopAtChapter ? '1' : '0');
  }

  function browser() {
    return typeof window !== 'undefined';
  }

  async function handleFile(ev: Event) {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    error = '';
    try {
      const { title: detected, text } = await loadFile(file);
      await loadBook(detected, text);
    } catch (e: any) {
      error = `读取失败：${e?.message || e}`;
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function loadBook(name: string, text: string) {
    engine?.destroy();
    const parsed = parseText(text);
    if (!parsed.totalChars) {
      error = '这个文件好像没有可读内容';
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
    if (!bookHash || !book) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      savePosition(bookHash, {
        title,
        revealed,
        total,
        updatedAt: Date.now(),
        preview: book!.flatText.slice(0, 60).replace(/\n/g, ' ')
      });
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

  function togglePlay() {
    engine?.toggle();
  }

  function bumpSpeed(delta: number) {
    speed = Math.max(1, Math.min(60, speed + delta));
  }

  async function resumeFromRecent(item: SavedPosition & { hash: string }) {
    busy = true;
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.epub,.md,.markdown,text/plain,application/epub+zip';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const { text } = await loadFile(file);
          const h = await hashContent(parseText(text).flatText);
          if (h !== item.hash) {
            error = '这不是同一本书：哈希不对。换个文件再试。';
            return;
          }
          await loadBook(item.title, text);
        } catch (e: any) {
          error = `读取失败：${e?.message || e}`;
        }
      };
      input.click();
    } finally {
      busy = false;
    }
  }

  function deleteRecent(hash: string) {
    removePosition(hash);
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
  <title>{book ? `${title} · AutoBook` : 'AutoBook'}</title>
</svelte:head>

{#if !book}
  <main class="landing">
    <h1>AutoBook</h1>
    <p class="lead">逐字浮现的阅读节奏。支持 .txt / .epub / .md。</p>

    <label class="upload">
      <input
        type="file"
        accept=".txt,.epub,.md,.markdown,text/plain,application/epub+zip"
        on:change={handleFile}
        disabled={busy}
      />
      <span>{busy ? '读取中…' : '选择文件'}</span>
    </label>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if recents.length}
      <section class="recents">
        <h2>最近读过</h2>
        <ul>
          {#each recents as r (r.hash)}
            <li>
              <button class="recent" on:click={() => resumeFromRecent(r)}>
                <div class="recent-title">{r.title}</div>
                <div class="recent-meta">
                  {Math.round((r.revealed / r.total) * 100)}% · {r.preview}…
                </div>
              </button>
              <button class="recent-del" title="删除记录" on:click={() => deleteRecent(r.hash)}>×</button>
            </li>
          {/each}
        </ul>
        <p class="hint">点条目重新选同一个文件即可继续上次进度。</p>
      </section>
    {/if}

    <footer>
      <button class="link" on:click={() => (syncOpen = true)}>跨设备同步阅读时长</button>
      <p>桌面完整版（高亮 / 笔记本 / AI / 离线词典 / Obsidian 同步）：<a href="https://github.com/fivood/autobook/releases/latest" rel="noopener">GitHub Releases</a></p>
    </footer>
  </main>
{:else}
  <div class="reader">
    <header class="topbar">
      <button class="ghost" on:click={() => { engine?.destroy(); engine = undefined; book = undefined; }}
        >‹ 关闭</button>
      <div class="header-title">
        <div class="book-title">{title}</div>
        {#if currentChapterTitle}
          <div class="chapter-title">{currentChapterTitle}</div>
        {/if}
      </div>
      <span class="progress-tag" title="今日累计 (含其它设备)">{progressPct}% · {formatDuration(todaySeconds)}</span>
    </header>

    <div class="viewport" bind:this={viewport}>
      <div class="page">
        <span class="revealed">{revealedText}</span><span
          class="cursor"
          bind:this={cursorEl}
          class:cursor-on={playing}
        />
        {#if pendingText}
          <span class="pending">{pendingText}</span>
        {/if}
      </div>
    </div>

    <div class="controls">
      <div class="row">
        <button class="chip" on:click={() => bumpSpeed(-1)}>−</button>
        <span class="speed">{speed} 字/秒</span>
        <button class="chip" on:click={() => bumpSpeed(1)}>+</button>
      </div>
      <button class="play" on:click={togglePlay} aria-label={playing ? '暂停' : '播放'}>
        {#if playing}
          <svg viewBox="0 0 24 24" width="32" height="32"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="32" height="32"><path d="M7 5v14l12-7L7 5z"/></svg>
        {/if}
      </button>
      <label class="row stop-at-chapter">
        <input type="checkbox" bind:checked={stopAtChapter} />
        <span>章止</span>
      </label>
    </div>

    {#if book.chapters.length > 1}
      <details class="toc">
        <summary>目录 · {book.chapters.length} 章</summary>
        <ul>
          {#each book.chapters as ch, i (i)}
            <li>
              <button class:active={i === chapterIdx} on:click={() => jumpToChapter(i)}>
                {ch.title || `（无标题段 ${i + 1}）`}
              </button>
            </li>
          {/each}
        </ul>
        <button class="restart" on:click={restart}>从头开始</button>
      </details>
    {/if}
    <button class="sync-fab" title="同步设置" on:click={() => (syncOpen = true)}>⇅</button>
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
  }
  .recent {
    flex: 1;
    text-align: left;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.6rem;
  }
  .recent-title {
    font-weight: 600;
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
    padding: 0 0.7rem;
    border: 1px solid var(--fg-dim);
    border-radius: 0.6rem;
    color: var(--fg-dim);
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
  }
  .page {
    max-width: 36em;
    margin: 0 auto;
    white-space: pre-wrap;
    word-break: break-word;
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
