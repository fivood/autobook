<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';
  import { faTimes, faMagnifyingGlass, faStop } from '@fortawesome/free-solid-svg-icons';
  import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
  import { database } from '$lib/data/store';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import { runOcr, type OcrProgress } from '$lib/functions/file-loaders/pdf/pdf-ocr-runner';

  export let book: BooksDbBookData;

  const ocrLang$ = writableStringLocalStorageSubject()('pdfOcrLang', 'chi_sim+eng');

  const dispatch = createEventDispatcher<{ dismissed: void }>();

  const LANGS: Array<{ code: string; label: string }> = [
    { code: 'chi_sim+eng', label: '简中 + 英' },
    { code: 'chi_tra+eng', label: '繁中 + 英' },
    { code: 'chi_sim', label: '简体中文' },
    { code: 'chi_tra', label: '繁体中文' },
    { code: 'eng', label: 'English' },
    { code: 'jpn', label: '日本語' }
  ];

  let dismissed = false;
  let running = false;
  let finished = false;
  let progress: OcrProgress | undefined;
  let lastError = '';
  let abortCtrl: AbortController | undefined;

  async function run() {
    if (running) return;
    running = true;
    finished = false;
    lastError = '';
    abortCtrl = new AbortController();
    try {
      const updated = await runOcr(book, $ocrLang$, (p) => {
        progress = p;
      }, abortCtrl.signal);
      const db = await database.db;
      await db.put('data', updated);
      finished = true;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        lastError = '已中止';
      } else {
        lastError = `OCR 失败：${err?.message || err}`;
      }
    } finally {
      running = false;
      abortCtrl = undefined;
    }
  }

  function applyAndReload() {
    window.location.reload();
  }

  function stop() {
    abortCtrl?.abort();
  }

  function dismiss() {
    dismissed = true;
    dispatch('dismissed');
  }
</script>

{#if !dismissed}
  <div class="banner">
    {#if running}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">OCR 运行中…{progress ? ` ${progress.page} / ${progress.total} 页` : ''}</div>
        {#if progress?.text}
          <div class="meta">{progress.text.slice(0, 80)}…</div>
        {/if}
      </div>
      <button class="btn danger" on:click={stop}><Fa icon={faStop} size="xs" /> 中止</button>
    {:else if finished}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">OCR 完成{progress ? `（共 ${progress.total} 页）` : ''}</div>
        <div class="meta">点「应用」刷新阅读器加载新内容</div>
      </div>
      <button class="btn primary" on:click={applyAndReload}>应用并刷新</button>
      <button class="btn ghost" on:click={dismiss} title="稍后再说"><Fa icon={faTimes} /></button>
    {:else}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">检测到扫描版 PDF（无文字层）</div>
        <div class="meta">运行 OCR 后可被打字机 / AI / 词典使用，首次会下载语言模型</div>
      </div>
      <label class="lang">
        <select bind:value={$ocrLang$} disabled={running}>
          {#each LANGS as l (l.code)}
            <option value={l.code}>{l.label}</option>
          {/each}
        </select>
      </label>
      <button class="btn primary" on:click={run}>开始</button>
      <button class="btn ghost" on:click={dismiss} title="本次会话不再提示"><Fa icon={faTimes} /></button>
    {/if}
    {#if lastError}
      <div class="err">{lastError}</div>
    {/if}
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: env(safe-area-inset-top, 0px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: 90vw;
    margin-top: 0.6rem;
    padding: 0.6rem 1rem;
    border-radius: 0.6rem;
    background: var(--menu-background);
    color: var(--menu-foreground);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    font-size: 0.85rem;
  }
  .ico { font-size: 1rem; opacity: 0.9; }
  .text { flex: 1; min-width: 0; }
  .title { font-weight: 600; }
  .meta { font-size: 0.72rem; opacity: 0.75; margin-top: 0.15rem; }
  .lang select {
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.35rem;
    padding: 0.2rem 0.4rem;
    font-size: 0.78rem;
  }
  .btn {
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.35rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
  }
  .btn.primary { background: rgba(255, 255, 255, 0.18); }
  .btn.danger { background: rgba(220, 90, 90, 0.35); border-color: rgba(220, 90, 90, 0.5); }
  .btn.ghost { background: transparent; border-color: transparent; opacity: 0.7; padding: 0.3rem 0.5rem; }
  .err {
    width: 100%;
    margin-top: 0.4rem;
    font-size: 0.72rem;
    opacity: 0.85;
    color: #ffc8c8;
  }
</style>
