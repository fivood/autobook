<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faTimes,
    faMagnifyingGlass,
    faStop,
    faWandMagicSparkles
  } from '@fortawesome/free-solid-svg-icons';
  import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
  import {
    abortOcrJob,
    clearOcrJob,
    isOcrJobRunning,
    ocrJob$,
    startOcrJob,
    type OcrLanguage,
    type OcrModelProfile
  } from '$lib/functions/file-loaders/pdf/ocr-job-manager';
  import {
    abortOcrCorrectJob,
    clearOcrCorrectJob,
    hasCorrectableText,
    isOcrCorrectJobRunning,
    ocrCorrectJob$,
    startOcrCorrectJob
  } from '$lib/functions/file-loaders/pdf/ocr-correct-job';
  import { resolveEndpoint, type ResolvedEndpoint } from '$lib/data/ai/endpoint';
  import { probeLocalModels } from '$lib/data/ai/local-model';
  import { database } from '$lib/data/store';
  import {
    aiOcrCorrectEnabled$,
    ocrModelProfile$,
    pdfOcrLang$,
    pdfOcrPromptEnabled$,
    pdfOcrSkippedBookIds$ as ocrSkippedBooks$
  } from '$lib/data/store';
  import {
    OCR_LANGUAGE_OPTIONS,
    isOcrLanguageSupported,
    normalizeOcrModelProfile
  } from '$lib/functions/file-loaders/pdf/ocr-options';
  import { t } from '$lib/i18n';

  export let book: BooksDbBookData;

  const dispatch = createEventDispatcher<{ dismissed: void }>();

  $: skippedIds = new Set(($ocrSkippedBooks$ || '').split(',').filter(Boolean).map(Number));
  $: skippedForThisBook = book?.id != null && skippedIds.has(book.id);

  let dismissed = false;
  // Job state for THIS book only — ignore jobs belonging to other books.
  $: jobForThisBook = $ocrJob$ && $ocrJob$.bookId === book.id ? $ocrJob$ : null;
  $: otherBookRunning = !!$ocrJob$ && $ocrJob$.bookId !== book.id && $ocrJob$.status === 'running';

  // Per-book language wins over the global default. Changed on the fly in the
  // banner; persisted back onto the book so a Japanese scan stays on `japan`
  // even after the global default is changed for a different book.
  $: activeProfile = normalizeOcrModelProfile($ocrModelProfile$);
  $: availableLangs = OCR_LANGUAGE_OPTIONS.filter((lang) => isOcrLanguageSupported(lang.code, activeProfile));
  $: storedOcrLang = (book.ocrLang || $pdfOcrLang$) as OcrLanguage;
  $: ocrLang = isOcrLanguageSupported(storedOcrLang, activeProfile) ? storedOcrLang : 'ch';

  function setOcrLang(value: OcrLanguage) {
    if (!value) return;
    ocrLang = value;
    pdfOcrLang$.next(value);
    // Write the per-book override back. Best-effort — if the write fails the
    // global default still holds for this session.
    database.db
      .then(async (db) => {
        const fresh = await db.get('data', book.id);
        if (fresh) await db.put('data', { ...fresh, ocrLang: value });
      })
      .catch(() => {
        // A failed per-book write just loses the override; global default wins.
      });
  }

  function onLangChange(event: Event) {
    setOcrLang((event.currentTarget as HTMLSelectElement).value as OcrLanguage);
  }

  function start() {
    if (isOcrJobRunning()) return;
    if (storedOcrLang !== ocrLang) setOcrLang(ocrLang);
    startOcrJob(book, ocrLang as OcrLanguage, activeProfile as OcrModelProfile);
  }

  function applyAndReload() {
    clearOcrJob();
    window.location.reload();
  }

  function dismissResult() {
    clearOcrJob();
  }

  function dismiss() {
    dismissed = true;
    dispatch('dismissed');
  }

  function dontAskForThisBook() {
    if (book?.id == null) return;
    const next = new Set(skippedIds);
    next.add(book.id);
    $ocrSkippedBooks$ = Array.from(next).join(',');
    dismissed = true;
    dispatch('dismissed');
  }

  // ── OCR post-correction ────────────────────────────────────────────
  // Corrects the transparent text layer only; the page image the reader
  // looks at never changes. So this improves selection / search / TTS /
  // AI context, and a poor result costs nothing visible and is re-runnable.

  let endpoint: ResolvedEndpoint | undefined;
  let correctDismissed = false;

  onMount(() => {
    // 3B is the floor where fixing glyph confusions stops introducing new
    // errors of its own.
    probeLocalModels()
      .then(() => (endpoint = resolveEndpoint('prefer-local', 3)))
      .catch(() => {
        // Absent runtime simply leaves `endpoint` undefined; no UI appears.
      });
  });

  $: correctJobForThisBook =
    $ocrCorrectJob$ && $ocrCorrectJob$.bookId === book.id ? $ocrCorrectJob$ : null;
  $: correctOtherBookRunning =
    !!$ocrCorrectJob$ && $ocrCorrectJob$.bookId !== book.id && $ocrCorrectJob$.status === 'running';
  // Offered once the book actually has a text layer, which is also true for
  // books OCR'd in an earlier session — those never show the OCR prompt again.
  $: canCorrect =
    $aiOcrCorrectEnabled$ &&
    !!endpoint &&
    !correctDismissed &&
    !correctJobForThisBook &&
    !!book?.elementHtml &&
    hasCorrectableText(book);

  function startCorrect() {
    if (!endpoint || isOcrCorrectJobRunning()) return;
    startOcrCorrectJob(book, endpoint.opts);
  }

  function applyCorrectAndReload() {
    clearOcrCorrectJob();
    window.location.reload();
  }
</script>

{#if !dismissed && !skippedForThisBook && $pdfOcrPromptEnabled$}
  <div class="banner">
    {#if jobForThisBook?.status === 'running'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">{$t('ocrBanner.running', { page: jobForThisBook.progress.page, total: jobForThisBook.progress.total })}</div>
        {#if jobForThisBook.progress.text}
          <div class="meta">{jobForThisBook.progress.text.slice(0, 80)}…</div>
        {:else}
          <div class="meta">{$t('ocrBanner.runningHint')}</div>
        {/if}
      </div>
      <button class="btn danger" on:click={abortOcrJob}><Fa icon={faStop} size="xs" /> {$t('ocrBanner.abort')}</button>
    {:else if jobForThisBook?.status === 'finished'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        {#if jobForThisBook.failedPages && jobForThisBook.failedPages >= (jobForThisBook.totalPages ?? jobForThisBook.progress.total)}
          <!-- Every page failed. Saying 「OCR 完成」 here is how a textless book
               used to look identical to a good one. -->
          <div class="title">
            {$t('ocrBanner.allFailed', { n: jobForThisBook.totalPages ?? jobForThisBook.progress.total })}
          </div>
          <div class="meta">
            {jobForThisBook.firstFailure || $t('ocrBanner.retryHint')} ·
            {$t('ocrBanner.unchanged')}
          </div>
        {:else if jobForThisBook.failedPages}
          <div class="title">
            {$t('ocrBanner.partial', { total: jobForThisBook.progress.total, failed: jobForThisBook.failedPages })}
          </div>
          <div class="meta">{jobForThisBook.firstFailure || $t('ocrBanner.applyHint')}</div>
        {:else}
          <div class="title">{$t('ocrBanner.done', { total: jobForThisBook.progress.total })}</div>
          <div class="meta">{$t('ocrBanner.applyHint')}</div>
        {/if}
      </div>
      <button class="btn primary" on:click={applyAndReload}>{$t('ocrBanner.applyReload')}</button>
      <button class="btn ghost" on:click={dismissResult} title={$t('ocrBanner.later')}><Fa icon={faTimes} /></button>
    {:else if jobForThisBook?.status === 'errored'}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">{$t('ocrBanner.failed')}</div>
        <div class="meta">{jobForThisBook.error}</div>
      </div>
      <button class="btn primary" on:click={start}>{$t('ocrBanner.retry')}</button>
      <button class="btn ghost" on:click={dismissResult}><Fa icon={faTimes} /></button>
    {:else}
      <Fa icon={faMagnifyingGlass} class="ico" />
      <div class="text">
        <div class="title">{$t('ocrBanner.detected')}</div>
        <div class="meta">
          {otherBookRunning
            ? $t('ocrBanner.busyOther', { title: $ocrJob$?.bookTitle ?? '' })
            : $t('ocrBanner.intro')}
        </div>
      </div>
      <label class="lang">
        <select value={ocrLang} on:change={onLangChange} disabled={otherBookRunning}>
          {#each availableLangs as l (l.code)}
            <option value={l.code}>{$t(l.labelKey)}</option>
          {/each}
        </select>
      </label>
      <button class="btn primary" on:click={start} disabled={otherBookRunning}>{$t('ocrBanner.start')}</button>
      <button class="btn" on:click={dontAskForThisBook} title={$t('ocrBanner.imagesOnlyTitle')}>{$t('ocrBanner.imagesOnly')}</button>
      <button class="btn ghost" on:click={dismiss} title={$t('ocrBanner.dismissSession')}><Fa icon={faTimes} /></button>
    {/if}
  </div>
{/if}

<!--
  Correction lives in its own block rather than a branch of the one above:
  that banner is suppressed once a book lands in the OCR skip list, which is
  exactly the state a previously-OCR'd book is in — the one that most needs
  correcting.
-->
{#if correctJobForThisBook}
  <div class="banner">
    {#if correctJobForThisBook.status === 'running'}
      <Fa icon={faWandMagicSparkles} class="ico" />
      <div class="text">
        <div class="title">
          {$t('ocrBanner.correctRunning', { batch: correctJobForThisBook.progress.batch, total: correctJobForThisBook.progress.totalBatches })}
        </div>
        <div class="meta">
          {$t('ocrBanner.correctProgress', { lines: correctJobForThisBook.progress.linesCorrected, model: correctJobForThisBook.modelId })}
        </div>
      </div>
      <button class="btn danger" on:click={abortOcrCorrectJob}>
        <Fa icon={faStop} size="xs" /> {$t('ocrBanner.abort')}
      </button>
    {:else if correctJobForThisBook.status === 'finished'}
      <Fa icon={faWandMagicSparkles} class="ico" />
      <div class="text">
        <div class="title">
          {$t('ocrBanner.correctDone', { fixed: correctJobForThisBook.progress.linesCorrected, total: correctJobForThisBook.progress.totalLines })}
        </div>
        <div class="meta">
          {correctJobForThisBook.failedBatches
            ? $t('ocrBanner.correctPartial', { n: correctJobForThisBook.failedBatches })
            : $t('ocrBanner.correctApplyHint')}
        </div>
      </div>
      <button class="btn primary" on:click={applyCorrectAndReload}>{$t('ocrBanner.applyReload')}</button>
      <button class="btn ghost" on:click={clearOcrCorrectJob}><Fa icon={faTimes} /></button>
    {:else}
      <Fa icon={faWandMagicSparkles} class="ico" />
      <div class="text">
        <div class="title">{$t('ocrBanner.correctFailed')}</div>
        <div class="meta">{correctJobForThisBook.error}</div>
      </div>
      <button class="btn primary" on:click={startCorrect}>{$t('ocrBanner.retry')}</button>
      <button class="btn ghost" on:click={clearOcrCorrectJob}><Fa icon={faTimes} /></button>
    {/if}
  </div>
{:else if canCorrect}
  <div class="banner">
    <Fa icon={faWandMagicSparkles} class="ico" />
    <div class="text">
      <div class="title">{$t('ocrBanner.correctOffer')}</div>
      <div class="meta">
        {correctOtherBookRunning
          ? $t('ocrBanner.correctBusyOther', { title: $ocrCorrectJob$?.bookTitle ?? '' })
          : $t('ocrBanner.correctIntro', { endpoint: endpoint?.label ?? '' })}
      </div>
    </div>
    <button class="btn primary" on:click={startCorrect} disabled={correctOtherBookRunning}>
      {$t('ocrBanner.correctStart')}
    </button>
    <button class="btn ghost" on:click={() => (correctDismissed = true)} title={$t('ocrBanner.dismissSession')}>
      <Fa icon={faTimes} />
    </button>
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
  :global(.ico) { font-size: 1rem; opacity: 0.9; }
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
</style>
