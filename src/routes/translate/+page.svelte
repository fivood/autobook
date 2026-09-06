<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import PageHeader from '$lib/components/page-header/page-header.svelte';
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import { pagePath } from '$lib/data/env';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';
  import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
  import { adapterForTranslationDocument, checkLocalTranslationRuntime, createCloudTranslationProvider, createDraftProvider, createLocalTranslationProvider, draftModel, isComicFile, inspectStoredBook, inspectTranslationFile, listLocalTranslationModels, localTranslationBaseUrl, qwenMtDraftReady, type TranslationSource } from '$lib/data/translation/translation-core';
  import { extractComicPages } from '$lib/data/translation/comic-extract';
  import { ocrComic, persistCorrectedBubbles, type ComicOcrProgress } from '$lib/data/translation/comic-ocr-pipeline';
  import { correctComicBubbles, type ComicCorrectionProgress } from '$lib/data/translation/comic-ocr-correct';
  import { comicCacheKey } from '$lib/data/translation/comic-cache-key';
  import { hasIndexableText } from '$lib/data/ai/has-indexable-text';
  import { inpaintPageWithLama, type InpaintBubble } from '$lib/functions/comic-inpaint';
  import { prewarmOcr } from '$lib/functions/file-loaders/pdf/pdf-ocr';
  import {
    OCR_LANGUAGE_OPTIONS,
    isOcrLanguageSupported,
    normalizeOcrModelProfile,
    ocrModelCacheId,
    type OcrModelProfile
  } from '$lib/functions/file-loaders/pdf/ocr-options';
  import { resolveEndpoint } from '$lib/data/ai/endpoint';
  import { probeLocalModels } from '$lib/data/ai/local-model';
  import { createComicStorage } from '$lib/data/translation/comic-storage';
  import { isOcrDownloaded } from '$lib/data/models-registry';
  import { pickDraftModel } from '$lib/data/translation/translation-model-registry';
  import { ComicAdapter, type OcrEngineLanguage } from 'translator-workbench';
  import { aiApiKey$, aiModel$, aiProvider$, aiOcrCorrectEnabled$, database, ocrModelProfile$, translateBatchSegments$, translateChunkChars$, translateComicAutoOcr$, translateDraftSource$, translateLamaEndpoint$, translateLocalModel$, translateMaxSourceChars$, translateOcrLang$, translateReviewSource$, translateTargetLang$ } from '$lib/data/store';
  import { DEFAULT_GLOSSARY_PROFILE_ID, getGlossaryProfile, getLatestTranslationJob, saveGlossaryProfile, saveTranslationJob, deleteTranslationJob } from '$lib/data/translation/translation-job-store';
  import { exportHtmlAsMarkdownChunks, extractGlossaryCandidates, translateInBatches } from 'translator-workbench';
  import { createJob, pendingSegments, recordTranslationResults, setJobStatus, validateTranslationJob } from 'translator-workbench';
  import type { ComicBubble, ComicStorage, DocumentAdapter, GlossaryEntry, ModelInfo, TranslationDocument, TranslationJob, TranslationResult } from 'translator-workbench';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { t, tImmediate } from '$lib/i18n';

  let translationDocument: TranslationDocument | undefined;
  let documentAdapter: DocumentAdapter | undefined;
  let documentExtension = 'epub';
  let importQueue: File[] = [];
  let activeFileName = '';
  let translationJob: TranslationJob | undefined;
  let latestJob: TranslationJob | undefined;
  let models: ModelInfo[] = [];
  let glossaryCandidates: Array<{ source: string; occurrences: number; reason: string; sampleSegmentIds: string[] }> = [];
  let glossaryTargets: Record<string, string> = {};
  let worldGlossary: GlossaryEntry[] = [];
  let reuseWorldGlossary = true;
  let saveToWorldGlossary = true;
  let selectedModel = translateLocalModel$.getValue() || '';
  // Review pass uses its own local model — the draft defaults to a
  // translation-specialized model (Hy-MT2), review should stay on a general
  // chat model. Kept independent so picking one doesn't force the other.
  let reviewLocalModel = '';
  let modelSelectionTouched = false;
  let targetLanguage = translateTargetLang$.getValue() || 'zh-CN';
  let translations = new Map<string, string>();
  let runtimeMessage = tImmediate('translate.runtime.unchecked');
  let precisionMessage = tImmediate('translate.precision.unconfigured');
  let markdownChunkChars = Number(translateChunkChars$.getValue()) || 24000;

  // Defaults snapshot — taken once at page load so we can tell which fields
  // were changed from their configured defaults.
  const defaults = {
    targetLanguage: targetLanguage,
    draftSource: translateDraftSource$.getValue(),
    reviewSource: translateReviewSource$.getValue(),
    localModel: selectedModel,
    chunkChars: markdownChunkChars
  };

  $: targetLangOverridden = targetLanguage !== defaults.targetLanguage;
  $: draftSourceOverridden = $translateDraftSource$ !== defaults.draftSource;
  $: reviewSourceOverridden = $translateReviewSource$ !== defaults.reviewSource;
  $: localModelOverridden = selectedModel !== defaults.localModel;
  $: chunkCharsOverridden = markdownChunkChars !== defaults.chunkChars;

  function resetField(field: keyof typeof defaults) {
    switch (field) {
      case 'targetLanguage': targetLanguage = defaults.targetLanguage; break;
      case 'draftSource': $translateDraftSource$ = defaults.draftSource; break;
      case 'reviewSource': $translateReviewSource$ = defaults.reviewSource; break;
      case 'localModel': selectedModel = defaults.localModel; modelSelectionTouched = false; break;
      case 'chunkChars': markdownChunkChars = defaults.chunkChars; break;
    }
  }
  let statusMessage = '';
  let errorMessage = '';
  let comicOcrProgress: ComicOcrProgress | undefined;
  $: activeOcrProfile = normalizeOcrModelProfile($ocrModelProfile$);
  let enteredFromBook = false;
  let pendingComicOcr: {
    blobs: Blob[];
    title: string;
    fmt: string;
    book?: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData;
  } | undefined;
  // Skip-cover defaults are format-aware: comics conventionally start with a
  // cover page worth skipping, scanned PDFs do not. Reset per book so a
  // previous comic's choices don't leak onto the next PDF.
  let comicSkipCover = true;
  let comicSkipBackCover = true;
  let prevPage = `${pagePath}${mergeEntries.MANAGE.routeId}`;

  afterNavigate((navigation) => {
    const { from } = navigation;
    if (!from?.url) return;
    prevPage = `${from.url.pathname}${from.url.search}`;
  });
  /** Parsing an imported file. Separate from `running` on purpose — see below. */
  let loading = false;
  /**
   * A draft or review pass is in flight. This used to share `loading` with
   * file parsing, so starting a translation lit up "parsing…" in the import
   * card and told the reader a file was being read when nothing of the sort
   * was happening.
   */
  let running = false;
  let activeAbortController: AbortController | undefined;
  let checkpointWarnings: string[] = [];

  /** Anything in flight — for controls that must be disabled either way. */
  $: busy = loading || running;

  /**
   * `setJobStatus` mutates `job.status` in place, and `translationJob` keeps
   * pointing at that same object, so re-assigning it hands Svelte an
   * unchanged reference and anything derived from `translationJob.status`
   * never recomputes: the status label sat on the previous state after both
   * the draft and the review pass finished (only a reload fixed it).
   * Tracking the status as its own primitive sidesteps object identity
   * entirely, so every assignment must go through here.
   */
  let jobStatus = '';

  function applyJob(job: TranslationJob | undefined) {
    translationJob = job;
    jobStatus = job?.status ?? '';
  }

  $: draftSource = $translateDraftSource$ as TranslationSource;
  $: reviewSource = $translateReviewSource$ as TranslationSource;
  $: draftIsCloud = draftSource === 'cloud';
  $: reviewIsCloud = reviewSource === 'cloud';
  $: cloudModel = ($aiModel$ || '').trim();
  $: cloudProvider = ($aiProvider$ || 'anthropic');
  $: cloudReady = !!$aiApiKey$ && !!cloudModel;
  // Draft pass: ready when the generic cloud LLM or the translation-specialized
  // Qwen-MT draft provider is configured.
  $: draftReady = draftIsCloud ? (cloudReady || qwenMtDraftReady()) : !!selectedModel;
  $: precisionReady = reviewIsCloud ? cloudReady : !!(reviewLocalModel || selectedModel);

  $: completedSegmentCount = translations.size;
  $: totalSegmentCount = translationDocument?.segments.length || 0;
  $: progressPercent = totalSegmentCount ? Math.min(100, Math.round((completedSegmentCount / totalSegmentCount) * 100)) : 0;
  $: remainingSegmentCount = Math.max(0, totalSegmentCount - completedSegmentCount);
  // Covers every TranslationJobStatus the package declares. The two that got
  // missed first time round — `draft` and `glossary-review` — are exactly the
  // ones a freshly created job sits in, so the workbench greeted you with a
  // raw enum until the first batch finished. An unknown status still falls
  // through to its raw value: if the package adds a state, showing it beats
  // silently labelling it "not started".
  const JOB_STATUS_KEYS: Record<string, string> = {
    draft: 'translate.status.draft',
    'glossary-review': 'translate.status.glossaryReview',
    drafting: 'translate.status.drafting',
    paused: 'translate.status.paused',
    failed: 'translate.status.failed',
    review: 'translate.status.review',
    completed: 'translate.status.completed'
  };
  $: jobStatusLabel = !jobStatus
    ? $t('translate.status.idle')
    : JOB_STATUS_KEYS[jobStatus]
      ? $t(JOB_STATUS_KEYS[jobStatus])
      : jobStatus;

  onMount(async () => {
    // Warm the shared local-model probe so the comic OCR correction step can
    // resolve a local endpoint without a settings detour. TTL-cached; the
    // reader/settings routes usually probed it already.
    probeLocalModels().catch(() => {
      // Absent runtime leaves the probe 'unavailable'; correction falls back
      // to raw OCR — no UI should appear over a dead runtime.
    });
    try {
      latestJob = await getLatestTranslationJob();
      if (latestJob) {
        const report = validateTranslationJob(latestJob);
        checkpointWarnings = report.warnings;
        if (report.repaired) await saveTranslationJob(latestJob);
      }
      const savedGlossarySettings = localStorage.getItem('autobook-translation-glossary-settings');
      if (savedGlossarySettings) {
        const config = JSON.parse(savedGlossarySettings) as { reuse?: boolean; save?: boolean };
        reuseWorldGlossary = config.reuse !== false;
        saveToWorldGlossary = config.save !== false;
      }
      const glossaryProfile = await getGlossaryProfile(DEFAULT_GLOSSARY_PROFILE_ID);
      worldGlossary = glossaryProfile?.entries.filter((entry) => entry.approved) || [];
      const bookId = Number($page.url.searchParams.get('bookId') || '');
      if (bookId) {
        let book = await database.getData(bookId);
        if (book) {
          enteredFromBook = true;
          activeFileName = book.title || '';
          // On-disk library books arrive as empty stubs (see resolveFullStoredBook);
          // hydrate the real elementHtml/blobs before deciding on a path.
          book = await resolveFullStoredBook(book);
          const fmt = (book.originalFormat || '').toLowerCase();
          // The user opened the workbench because this book needs
          // translating. Decide by whether its text can be selected at all,
          // not by file extension: comics (cbz/cbr) AND scanned PDFs without
          // a text layer both go through OCR; books with selectable text
          // (EPUB/TXT/MD/text-layer PDF) translate directly.
          if (!hasIndexableText(book)) {
            await inspectStoredComic(book, fmt);
          } else {
            const bookLang = (book.language || '').toLowerCase();
            const targetLang = targetLanguage.toLowerCase();
            if (bookLang && targetLang && bookLang.split('-')[0] === targetLang.split('-')[0]) {
              statusMessage = tImmediate('translate.book.noTranslationNeeded');
            } else {
              const inspected = await inspectStoredBook(book);
              translationDocument = inspected.document;
              documentAdapter = inspected.adapter;
              documentExtension = inspected.extension;
              activeFileName = `${book.title}.html`;
              glossaryCandidates = extractGlossaryCandidates(translationDocument.segments, { minOccurrences: 2, maxCandidates: 80 });
              glossaryTargets = prefilledGlossaryTargets(glossaryCandidates);
              const created = createJob(newJobId(), translationDocument, translationDocument.sourceLanguage || 'en', targetLanguage, inheritedGlossary());
              applyJob(created);
              await saveTranslationJob(created);
              latestJob = undefined;
              statusMessage = tImmediate('translate.msg.createdFromBook');
            }
          }
        }
      }
      // No book was opened: if the most recent job was interrupted (paused by
      // the user or failed mid-way) with some segments done, leave it as the
      // resume card instead of loading it into the editor. The user reads the
      // card, decides, and clicks 恢复 / 继续初译 by hand — loading the job
      // automatically (or worse, auto-restarting translation) would both
      // pre-empt the user's intent and spend model tokens without being asked.
      if (!bookId && latestJob) {
        const interrupted =
          latestJob.status === 'paused' ||
          (latestJob.status === 'failed' && Object.keys(latestJob.translations).length > 0);
        if (interrupted) {
          await checkOllama();
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  });

  function newJobId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `job-${Date.now()}`;
  }

  async function restoreLatestJob() {
    if (!latestJob) return;
    const restoredJob = latestJob;
    const report = validateTranslationJob(restoredJob);
    checkpointWarnings = report.warnings;
    if (report.repaired) await saveTranslationJob(restoredJob);
    applyJob(restoredJob);
    translationDocument = restoredJob.document;
    documentAdapter = adapterForTranslationDocument(restoredJob.document);
    documentExtension = restoredJob.document.format === 'markdown' ? 'md' : restoredJob.document.format === 'htmlz' ? 'html' : restoredJob.document.format;
    targetLanguage = restoredJob.targetLanguage;
    translations = new Map(Object.entries(restoredJob.translations));
    glossaryCandidates = [];
    glossaryTargets = Object.fromEntries(restoredJob.glossary.map((entry) => [entry.source, entry.target]));
    statusMessage = tImmediate('translate.msg.restored', { done: translations.size, total: translationDocument.segments.length });
    latestJob = undefined;
  }

  async function discardLatestJob() {
    if (!latestJob) return;
    const target = latestJob;
    const ok = confirm(tImmediate('translate.resume.deleteConfirm', { title: target.document.title || target.id }));
    if (!ok) return;
    try {
      await deleteTranslationJob(target.id);
      latestJob = undefined;
      statusMessage = tImmediate('translate.msg.jobDeleted');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  async function inspect(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    importQueue = Array.from(input.files || []).filter((candidate) => /\.(epub|html|htm|txt|text|md|markdown|cbz|cbr)$/i.test(candidate.name));
    const file = importQueue[0];
    if (!file) return;
    if (isComicFile(file)) {
      await inspectComicFile(file);
    } else {
      await inspectFile(file);
    }
  }

  async function inspectFile(file: File) {
    loading = true;
    errorMessage = '';
    statusMessage = '';
    translationDocument = undefined;
    documentAdapter = undefined;
    applyJob(undefined);
    translations = new Map();
    try {
      const inspected = await inspectTranslationFile(file);
      translationDocument = inspected.document;
      documentAdapter = inspected.adapter;
      documentExtension = inspected.extension;
      activeFileName = file.name;
      glossaryCandidates = extractGlossaryCandidates(translationDocument.segments, { minOccurrences: 2, maxCandidates: 80 });
      glossaryTargets = prefilledGlossaryTargets(glossaryCandidates);
      const created = createJob(newJobId(), translationDocument, translationDocument.sourceLanguage || 'en', targetLanguage, inheritedGlossary());
      applyJob(created);
      checkpointWarnings = [];
      await saveTranslationJob(created);
      latestJob = undefined;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  async function inspectComicFile(file: File) {
    loading = true;
    errorMessage = '';
    statusMessage = tImmediate('translate.comic.extracting');
    // Clear any previous document/job state so a comic import doesn't leave
    // the last text book's title/language/segment counts on screen.
    translationDocument = undefined;
    documentAdapter = undefined;
    applyJob(undefined);
    translations = new Map();
    glossaryCandidates = [];
    glossaryTargets = {};
    try {
      const { title, pageBlobs } = await extractComicPages(file);
      activeFileName = file.name;
      loading = false;
      if (translateComicAutoOcr$.getValue()) {
        await runComicOcr(pageBlobs, title, file.name.split('.').pop()?.toLowerCase() || 'cbz');
      } else {
        const fmt = file.name.split('.').pop()?.toLowerCase() || 'cbz';
        comicSkipCover = fmt === 'cbz' || fmt === 'cbr';
        comicSkipBackCover = fmt === 'cbz' || fmt === 'cbr';
        pendingComicOcr = { blobs: pageBlobs, title, fmt };
        // Warm PaddleOCR while the user reads the pending card.
        prewarmOcr(ocrLangForBook(undefined), activeOcrProfile);
        statusMessage = tImmediate('translate.comic.pendingOcr', { pages: pageBlobs.length });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      loading = false;
    }
  }

  /**
   * Books stored in the on-disk library (INTERNAL_TAURI_FS) keep only
   * metadata in IndexedDB — `elementHtml` and `blobs` are empty placeholders,
   * the real content lives in `<root>/<title>/bookdata_*.json`. The reader
   * pulls it via the FS handler's `getBook()` before rendering; the workbench
   * must do the same or OCR finds no pages. Non-FS books (or FS loads that
   * fail) return the record untouched so the existing error path fires.
   */
  async function resolveFullStoredBook(book: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData): Promise<import('$lib/data/database/books-db/versions/books-db').BooksDbBookData> {
    const isFsStub =
      book.storageSource === InternalStorageSources.INTERNAL_TAURI_FS ||
      book.storageSource === InternalStorageSources.INTERNAL_DEFAULT;
    if (!isFsStub || Object.keys(book.blobs || {}).length) return book;
    try {
      const external = getStorageHandler(
        window,
        StorageKey.TAURI_FS,
        book.storageSource,
        true
      );
      external.startContext({ id: book.id, title: book.title });
      const loaded = await external.getBook();
      if (loaded && (loaded as import('$lib/data/database/books-db/versions/books-db').BooksDbBookData).blobs) {
        const full = loaded as import('$lib/data/database/books-db/versions/books-db').BooksDbBookData;
        return { ...book, ...full };
      }
    } catch {
      // Failed disk load keeps the stub so inspectStoredComic / inspectStoredBook
      // surface their normal "no translatable content" error instead of a raw
      // fs exception.
    }
    return book;
  }

  async function inspectStoredComic(book: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData, fmt: string) {
    const pageBlobs: Blob[] = [];
    const blobEntries = Object.entries(book.blobs || {})
      // Both image-book formats land here: comics (cbz-page-*) and scanned
      // PDFs (pdf-page-*). The user opened the workbench to translate, so the
      // question is "can the text be selected?" — not the file extension.
      .filter(([key]) => /^(cbz|pdf)-page-\d+\.\w+$/.test(key))
      .sort(([a], [b]) => {
        const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return na - nb;
      });
    for (const [, blob] of blobEntries) pageBlobs.push(blob as Blob);
    if (!pageBlobs.length) {
      errorMessage = tImmediate('translate.error.noHtml');
      return;
    }
    // Comics skip their cover / back cover by default; scanned PDFs usually
    // have real content on page 1, so leave everything in.
    comicSkipCover = fmt === 'cbz' || fmt === 'cbr';
    comicSkipBackCover = fmt === 'cbz' || fmt === 'cbr';
    if (translateComicAutoOcr$.getValue()) {
      await runComicOcr(pageBlobs, book.title || '', fmt, book);
    } else {
      pendingComicOcr = { blobs: pageBlobs, title: book.title || '', fmt, book };
      // Warm PaddleOCR while the user reads the pending card; the model init
      // (~10s) then overlaps the review instead of blocking "Run OCR".
      prewarmOcr(ocrLangForBook(book), activeOcrProfile);
      statusMessage = tImmediate('translate.comic.pendingOcr', { pages: pageBlobs.length });
    }
  }

  function ocrLangFromStore(): OcrEngineLanguage {
    const lang = (translateOcrLang$.getValue() || 'japan') as OcrEngineLanguage;
    return isOcrLanguageSupported(lang, normalizeOcrModelProfile(ocrModelProfile$.getValue()))
      ? lang
      : 'japan';
  }

  /**
   * Bubble inpainting (M2): erase source text by filling each uniform bubble
   * with its sampled background colour, then store the result in the comic
   * cache so the reader can show translated text on a clean page. Best-effort
   * — skipped bubbles (gradient / textured backgrounds) stay as-is for a later
   * LaMa pass.
   */
  /**
   * Erase source text from bubbles. Returns what went wrong, if anything.
   *
   * Two very different failures live here and they need separate reporting:
   *
   * - a page throwing (bad image, cache write) — rare, and if it happens to
   *   every page the run achieved nothing
   * - LaMa being configured but unreachable — *not* fatal. The local flat-fill
   *   pass has already erased every uniform bubble; LaMa only ever handles the
   *   complex-background ones it skipped. So the page is still improved, but
   *   the bubbles the user set the endpoint up for stay dirty, silently.
   *
   * An earlier version of this comment claimed a dead endpoint meant nothing
   * was erased at all. That was wrong — inpaintPageWithLama falls back to the
   * flat-filled page — and it was only caught by pointing a real run at a dead
   * port and watching six bubbles get erased anyway.
   */
  async function runComicInpaint(
    pageBlobs: Blob[],
    bubbles: ComicBubble[],
    cacheKey: string,
    storage: ComicStorage
  ): Promise<{
    attempted: number;
    failed: number;
    firstError?: string;
    lamaMissed: number;
    lamaError?: string;
  }> {
    const byPage = new Map<number, InpaintBubble[]>();
    for (const b of bubbles) {
      const list = byPage.get(b.pageIndex) || [];
      list.push({ id: b.id, poly: b.poly });
      byPage.set(b.pageIndex, list);
    }
    const lamaEndpoint = translateLamaEndpoint$.getValue().trim();
    // Empty endpoint is the documented "off" switch, not a failure: skip
    // rather than throwing once per page and reporting it as breakage.
    let attempted = 0;
    let failed = 0;
    let firstError: string | undefined;
    let lamaMissed = 0;
    let lamaError: string | undefined;
    for (const [pageIndex, pageBubbles] of byPage) {
      const pageBlob = pageBlobs[pageIndex];
      if (!pageBlob) continue;
      attempted += 1;
      try {
        const page = await inpaintPageWithLama(pageBlob, pageBubbles, lamaEndpoint);
        if (page.result.inpainted > 0) {
          await storage.writeInpainted(cacheKey, pageIndex, page.blob);
        }
        if (page.lamaError) {
          lamaMissed += page.lamaMissed ?? 0;
          if (!lamaError) lamaError = page.lamaError;
        }
      } catch (err: any) {
        failed += 1;
        if (!firstError) firstError = err?.message || String(err);
      }
    }
    return { attempted, failed, firstError, lamaMissed, lamaError };
  }

  /** Per-book language wins over the global default for stored books. */
  function ocrLangForBook(book?: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData): OcrEngineLanguage {
    const profile = normalizeOcrModelProfile(ocrModelProfile$.getValue());
    if (book?.ocrLang && isOcrLanguageSupported(book.ocrLang, profile)) {
      return book.ocrLang as OcrEngineLanguage;
    }
    return ocrLangFromStore();
  }

  /**
   * Korean forces the dedicated v5-korean pipeline regardless of the global
   * profile — the shared CJK/Latin v6 model can't OCR Korean, and silently
   * running it would produce a garbage text layer. Global profile applies
   * to every other language.
   */
  function resolveOcrProfileForLang(lang: OcrEngineLanguage): OcrModelProfile {
    if (lang === 'korean') return 'v5-korean';
    return normalizeOcrModelProfile(ocrModelProfile$.getValue());
  }

  function onComicOcrLangChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isOcrLanguageSupported(value, activeOcrProfile)) return;
    translateOcrLang$.next(value);
    prewarmOcr(value as OcrEngineLanguage, activeOcrProfile);
    if (pendingComicOcr?.book) persistBookOcrLang(pendingComicOcr.book, value as OcrEngineLanguage);
  }

  /** Persist the language used for this comic back onto the book, so the
   * next entry from the library starts on the same language. Best-effort. */
  async function persistBookOcrLang(book: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData, lang: OcrEngineLanguage): Promise<void> {
    try {
      const db = await database.db;
      const fresh = await db.get('data', book.id);
      if (fresh && fresh.ocrLang !== lang) {
        await db.put('data', { ...fresh, ocrLang: lang });
      }
    } catch {
      // Failed write just loses the per-book override; global default holds.
    }
  }

  const OCR_LANG_TO_SOURCE: Record<string, string> = {
    japan: 'ja', korean: 'ko', ch: 'zh', chinese_cht: 'zh-TW', en: 'en',
    french: 'fr', german: 'de', es: 'es', it: 'it', pt: 'pt',
    nl: 'nl', pl: 'pl', da: 'da', sv: 'sv', no: 'no',
    cs: 'cs', ro: 'ro', hu: 'hu', tr: 'tr', vi: 'vi'
  };

  function sourceLanguageFromOcrLang(ocrLang: OcrEngineLanguage): string {
    return OCR_LANG_TO_SOURCE[ocrLang] || 'en';
  }

  async function runComicOcr(pageBlobs: Blob[], title: string, fmt: string, book?: import('$lib/data/database/books-db/versions/books-db').BooksDbBookData) {
    loading = true;
    errorMessage = '';
    statusMessage = '';
    translationDocument = undefined;
    documentAdapter = undefined;
    applyJob(undefined);
    translations = new Map();
    comicOcrProgress = undefined;
    try {
      const startIdx = comicSkipCover ? 1 : 0;
      const endIdx = comicSkipBackCover && pageBlobs.length > 1 ? pageBlobs.length - 1 : pageBlobs.length;
      const ocrBlobs = pageBlobs.slice(startIdx, endIdx);
      if (!ocrBlobs.length) {
        statusMessage = tImmediate('translate.comic.pendingOcr', { pages: 0 });
        loading = false;
        return;
      }
      statusMessage = tImmediate('translate.comic.ocr', { done: 0, total: ocrBlobs.length });
      const storage = createComicStorage();
      if (!storage) {
        // Comic OCR's page/OCR cache lives in the Tauri filesystem; a plain
        // browser / dev-server tab has no invoke to reach it.
        statusMessage = tImmediate('translate.comic.desktopOnly');
        loading = false;
        return;
      }
      const jobId = newJobId();
      const ocrLang = ocrLangForBook(book);
      // Korean forces the dedicated v5-korean pipeline; everything else uses
      // the user's global OCR profile.
      const ocrProfile = resolveOcrProfileForLang(ocrLang);
      // Korean must not silently fall back to a non-Korean OCR model — a
      // shared CJK/Latin model would emit plausible-but-wrong text. Block the
      // task with an install prompt when the dedicated model is missing.
      if (ocrProfile === 'v5-korean' && !isOcrDownloaded('v5-korean')) {
        errorMessage = tImmediate('translate.comic.koreanModelNeeded');
        loading = false;
        return;
      }
      // Cache namespace is the book identity (title+fmt+lang+model), not the job
      // UUID — so re-entering the same book hits the OCR cache instead of
      // re-running the whole pipeline. See comic-cache-key.ts.
      const sourceLanguage = sourceLanguageFromOcrLang(ocrLang);
      const cacheKey = comicCacheKey(title, fmt, sourceLanguage, ocrModelCacheId(ocrProfile));
      // Warm the model while OCR's initial book-work (page writes, first
      // predict) runs; hides the ~10s first-load instead of blocking after
      // the user clicked "Run OCR".
      prewarmOcr(ocrLang as OcrEngineLanguage, ocrProfile);
      const { pages, bubbles, allCached } = await ocrComic(ocrBlobs, ocrLang, ocrProfile, cacheKey, storage, (progress) => {
        comicOcrProgress = progress;
        statusMessage = tImmediate('translate.comic.ocr', { done: progress.page + (progress.cached ? 1 : 0), total: progress.total });
      });
      // Persist the language actually used onto the book once OCR starts, so
      // the library→translate entry keeps using it without re-picking.
      if (book) await persistBookOcrLang(book, ocrLang);
      // Comic bubbles get the same LLM post-correction pass as printed-book
      // text layers, gated on the shared toggle. Untouched bubbles keep their
      // OCR text; a dead endpoint falls back to raw OCR rather than failing.
      let finalBubbles = bubbles;
      // When every page came from cache, the bubbles were already corrected on
      // the run that produced them (persisted below) — skip the LLM entirely
      // so a re-entry is a pure cache read.
      if (!allCached && aiOcrCorrectEnabled$.getValue()) {
        const endpoint = resolveEndpoint('prefer-local', 3);
        if (endpoint) {
          statusMessage = tImmediate('translate.comic.correcting');
          try {
            finalBubbles = await correctComicBubbles(bubbles, endpoint.opts, undefined, (correction: ComicCorrectionProgress) => {
              statusMessage = tImmediate('translate.comic.correctingProgress', { batch: correction.batch, total: correction.totalBatches });
            });
            // Persist so the next re-entry skips both OCR and correction.
            persistCorrectedBubbles(cacheKey, finalBubbles, storage);
          } catch (error) {
            // Correction is best-effort; the raw OCR bubbles are still usable.
            finalBubbles = bubbles;
          }
        }
      }
      const adapter = new ComicAdapter();
      const document = adapter.buildDocument(`${title}.${fmt}`, title, sourceLanguage, pages, finalBubbles);
      // Record the stable cache namespace so deleteTranslationJob can clean up
      // the right fs directory (see comic-cache-key.ts). Also record the
      // cover-skip offset so the reader maps bubble pageIndex (0-based within
      // the OCR'd slice) back to the raw data-pdf-page number (1-based on the
      // full CBZ) — otherwise translations land on the wrong page when the
      // cover is skipped.
      document.metadata.cacheKey = cacheKey;
      document.metadata.startPage = String(startIdx);
      translationDocument = document;
      documentAdapter = adapter;
      documentExtension = fmt;
      glossaryCandidates = extractGlossaryCandidates(document.segments, { minOccurrences: 2, maxCandidates: 80 });
      glossaryTargets = prefilledGlossaryTargets(glossaryCandidates);
      const created = createJob(jobId, document, sourceLanguage, targetLanguage, inheritedGlossary());
      applyJob(created);
      checkpointWarnings = [];
      await saveTranslationJob(created);
      latestJob = undefined;
      pendingComicOcr = undefined;
      // M2: erase source text from uniform bubbles so the reader overlay can
      // sit on a clean page. Runs after the job is saved — a failure here
      // loses only the inpainting, never the translation.
      statusMessage = tImmediate('translate.comic.inpainting');
      const inpaint = await runComicInpaint(ocrBlobs, finalBubbles, cacheKey, storage);
      if (inpaint.failed) {
        checkpointWarnings = [
          ...checkpointWarnings,
          tImmediate('translate.comic.inpaintFailed', {
            failed: inpaint.failed,
            attempted: inpaint.attempted,
            detail: inpaint.firstError ?? ''
          })
        ];
      }
      if (inpaint.lamaMissed) {
        checkpointWarnings = [
          ...checkpointWarnings,
          tImmediate('translate.comic.lamaUnreachable', {
            missed: inpaint.lamaMissed,
            detail: inpaint.lamaError ?? ''
          })
        ];
      }
      statusMessage = tImmediate('translate.comic.ready', { pages: pages.length, bubbles: bubbles.length });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
      comicOcrProgress = undefined;
    }
  }

  async function checkOllama() {
    errorMessage = '';
    try {
      const health = await checkLocalTranslationRuntime();
      runtimeMessage = health.message;
      models = health.ok ? await listLocalTranslationModels() : [];
      if (models.length && (!modelSelectionTouched || !models.some((model) => model.id === selectedModel))) {
        const preferred = translateLocalModel$.getValue();
        // Draft-pass default: translation-specialized model (e.g. Hy-MT2)
        // wins over the biggest general chat model. Review can still pick any.
        const recommended = pickDraftModel(models);
        selectedModel = (preferred && models.some((m) => m.id === preferred))
          ? preferred
          : (recommended?.id || bestLocalModel(models));
      }
    } catch (error) {
      runtimeMessage = tImmediate('translate.runtime.unavailable');
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function approvedGlossary(): GlossaryEntry[] {
    const merged = new Map<string, GlossaryEntry>();
    for (const entry of inheritedGlossary()) merged.set(entry.source.toLocaleLowerCase(), { ...entry });
    for (const candidate of glossaryCandidates
      .filter((candidate) => glossaryTargets[candidate.source]?.trim())
      .map((candidate) => ({
        id: `glossary-${candidate.source}`,
        source: candidate.source,
        target: glossaryTargets[candidate.source].trim(),
        rule: 'preferred' as const,
        approved: true
      }))) {
      merged.set(candidate.source.toLocaleLowerCase(), candidate);
    }
    return [...merged.values()];
  }

  function inheritedGlossary(): GlossaryEntry[] {
    return reuseWorldGlossary ? worldGlossary.map((entry) => ({ ...entry })) : [];
  }

  function prefilledGlossaryTargets(candidates: typeof glossaryCandidates): Record<string, string> {
    const inherited = new Map(worldGlossary.map((entry) => [entry.source.toLocaleLowerCase(), entry.target]));
    return Object.fromEntries(candidates.map((candidate) => [
      candidate.source,
      reuseWorldGlossary ? inherited.get(candidate.source.toLocaleLowerCase()) || '' : ''
    ]));
  }

  function saveGlossarySettings() {
    localStorage.setItem('autobook-translation-glossary-settings', JSON.stringify({ reuse: reuseWorldGlossary, save: saveToWorldGlossary }));
  }

  function toggleWorldGlossaryReuse() {
    const inherited = new Map(worldGlossary.map((entry) => [entry.source.toLocaleLowerCase(), entry.target]));
    const next = { ...glossaryTargets };
    for (const candidate of glossaryCandidates) {
      const inheritedTarget = inherited.get(candidate.source.toLocaleLowerCase());
      if (!inheritedTarget) continue;
      if (reuseWorldGlossary && !next[candidate.source]) next[candidate.source] = inheritedTarget;
      if (!reuseWorldGlossary && next[candidate.source] === inheritedTarget) next[candidate.source] = '';
    }
    glossaryTargets = next;
    saveGlossarySettings();
  }

  async function persistWorldGlossary(entries: GlossaryEntry[]) {
    if (!saveToWorldGlossary || !entries.length) return;
    const merged = new Map<string, GlossaryEntry>();
    for (const entry of worldGlossary) merged.set(entry.source.toLocaleLowerCase(), { ...entry });
    for (const entry of entries) merged.set(entry.source.toLocaleLowerCase(), { ...entry });
    worldGlossary = [...merged.values()];
    await saveGlossaryProfile({
      id: DEFAULT_GLOSSARY_PROFILE_ID,
      // Stored data, not UI copy — deliberately not translated. A localised
      // name would fork this row per language and orphan glossaries built
      // under a different locale.
      name: '默认世界观',
      entries: worldGlossary,
      updatedAt: new Date().toISOString()
    });
  }

  function setGlossaryTarget(source: string, event: Event) {
    glossaryTargets = { ...glossaryTargets, [source]: (event.currentTarget as HTMLInputElement).value };
  }

  // Local-model ranking. Overlaps with pickDefaultLocalModel / parseParameterBillions
  // in $lib/data/ai/local-model.ts, which lands with the AI branch — fold this
  // into that one once both are on the same branch.
  function localModelScore(model: ModelInfo) {
    const parameterSize = Number(model.parameterSize?.match(/[0-9]+(?:\.[0-9]+)?/i)?.[0] || 0);
    return parameterSize || model.size || 0;
  }

  function bestLocalModel(modelList: ModelInfo[]) {
    return [...modelList].sort((left, right) => localModelScore(right) - localModelScore(left))[0]?.id || selectedModel;
  }

  async function startDraftTranslation() {
    if (!translationDocument || !translationJob) return;
    const job = translationJob;
    const checkpointReport = validateTranslationJob(job);
    checkpointWarnings = checkpointReport.warnings;
    running = true;
    errorMessage = '';
    if (glossaryCandidates.length || !job.glossary.length) job.glossary = approvedGlossary();
    await persistWorldGlossary(job.glossary);
    setJobStatus(job, 'drafting');
    applyJob(job);
    await saveTranslationJob(job);
    statusMessage = tImmediate('translate.msg.draftStarting');
    const abortController = new AbortController();
    activeAbortController = abortController;
    try {
      const provider = draftIsCloud ? createDraftProvider() : createLocalTranslationProvider();
      const model = draftIsCloud ? draftModel() : selectedModel;
      const batchSegments = Number(translateBatchSegments$.getValue()) || 3;
      const maxSourceChars = Number(translateMaxSourceChars$.getValue()) || 12000;
      await translateInBatches(pendingSegments(job), {
        provider,
        model,
        sourceLanguage: translationDocument.sourceLanguage || 'en',
        targetLanguage,
        glossary: job.glossary,
        // Local models translate faster and fail less on short batches — both
        // knobs are user-tunable in settings for exactly this reason.
        batchSize: batchSegments,
        maxSourceChars,
        maxRetries: 3,
        retryDelayMs: 2000,
        signal: abortController.signal,
        onBatchComplete: async (batch: TranslationResult[], index, count) => {
          recordTranslationResults(job, batch);
          await saveTranslationJob(job);
          translations = new Map(Object.entries(job.translations));
          statusMessage = tImmediate('translate.msg.draftProgress', { index: index + 1, count });
        }
      });
      setJobStatus(job, 'review');
      applyJob(job);
      await saveTranslationJob(job);
      statusMessage = tImmediate('translate.msg.draftDone', { done: translations.size, total: translationDocument.segments.length });
    } catch (error) {
      if (abortController.signal.aborted) {
        setJobStatus(job, 'paused');
        applyJob(job);
        statusMessage = tImmediate('translate.msg.draftPaused', { done: Object.keys(job.translations).length, total: translationDocument.segments.length });
        errorMessage = '';
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
        setJobStatus(job, 'failed', errorMessage);
        applyJob(job);
      }
      await saveTranslationJob(job);
      if (!abortController.signal.aborted) statusMessage = tImmediate('translate.msg.draftFailed');
    } finally {
      activeAbortController = undefined;
      running = false;
    }
  }

  function pauseTranslation() {
    if (!activeAbortController) return;
    statusMessage = tImmediate('translate.msg.pausing');
    activeAbortController.abort();
  }

  function normalizeMarkdownChunkChars() {
    const value = Number(markdownChunkChars);
    markdownChunkChars = Number.isFinite(value) ? Math.min(100000, Math.max(4000, Math.trunc(value))) : 24000;
  }

  function reviewProvider() {
    return reviewIsCloud ? createCloudTranslationProvider() : createLocalTranslationProvider();
  }

  function reviewModel() {
    return reviewIsCloud ? cloudModel : (reviewLocalModel || selectedModel);
  }

  async function checkReviewProvider() {
    errorMessage = '';
    const isCloud = reviewIsCloud;
    if (isCloud && !cloudReady) {
      precisionMessage = tImmediate('translate.precision.needsSettings');
      return;
    }
    if (!isCloud && !(reviewLocalModel || selectedModel)) {
      precisionMessage = tImmediate('translate.precision.needsSettings');
      return;
    }
    try {
      const provider = reviewProvider();
      const health = await provider.healthCheck();
      precisionMessage = health.message;
      if (health.ok) {
        const available = await provider.listModels();
        precisionMessage = available.length
          ? tImmediate('translate.precision.okModels', { models: available.map((model) => model.id).join(', ') })
          : health.message;
      }
    } catch (error) {
      precisionMessage = tImmediate('translate.precision.unavailable');
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  async function startPrecisionReview() {
    if (!translationDocument || !translationJob || !documentAdapter) return;
    if (!precisionReady) return;
    running = true;
    errorMessage = '';
    const job = translationJob;
    const sourceSegments = translationDocument.segments
      .filter((segment) => job.translations[segment.id])
      .map((segment) => ({ ...segment, source: job.translations[segment.id], target: undefined }));
    if (!sourceSegments.length) {
      running = false;
      precisionMessage = tImmediate('translate.precision.noSegments');
      return;
    }
    const abortController = new AbortController();
    activeAbortController = abortController;
    try {
      const provider = reviewProvider();
      const model = reviewModel();
      await translateInBatches(sourceSegments, {
        provider,
        model,
        sourceLanguage: targetLanguage,
        targetLanguage,
        glossary: job.glossary,
        // Model prompt, not UI copy — stays in one language on purpose so the
        // review pass behaves identically whatever the reader's locale is.
        styleGuide: '这是初译精校阶段。保持原意、专名和段落结构，只修正语法、语气、连贯性与明显误译。输出可直接替换初译文本。',
        batchSize: 6,
        maxSourceChars: 12000,
        maxRetries: 1,
        retryDelayMs: 2000,
        signal: abortController.signal,
        onBatchComplete: async (batch, index, count) => {
          recordTranslationResults(job, batch);
          await saveTranslationJob(job);
          translations = new Map(Object.entries(job.translations));
          precisionMessage = tImmediate('translate.msg.reviewProgress', { index: index + 1, count });
        }
      });
      setJobStatus(job, 'completed');
      applyJob(job);
      await saveTranslationJob(job);
      precisionMessage = tImmediate('translate.msg.reviewDone', { done: translations.size, total: translationDocument.segments.length });
    } catch (error) {
      if (abortController.signal.aborted) {
        setJobStatus(job, 'paused');
        applyJob(job);
        precisionMessage = tImmediate('translate.msg.reviewPaused');
        errorMessage = '';
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
        setJobStatus(job, 'failed', errorMessage);
        applyJob(job);
      }
      await saveTranslationJob(job);
      if (!abortController.signal.aborted) precisionMessage = tImmediate('translate.msg.reviewFailed');
    } finally {
      activeAbortController = undefined;
      running = false;
    }
  }

  async function exportDraft() {
    if (!translationDocument || !documentAdapter || !translations.size) return;
    try {
      const replacements = translationDocument.segments
        .filter((segment) => translations.has(segment.id))
        .map((segment) => ({ segmentId: segment.id, source: segment.source, target: translations.get(segment.id) || '' }));
      const bytes = await documentAdapter.export(translationDocument, replacements);
      const mime = documentExtension === 'epub'
        ? 'application/epub+zip'
        : documentExtension === 'html'
          ? 'text/html;charset=utf-8'
          : 'text/plain;charset=utf-8';
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = `${translationDocument.title || 'translated'}.draft.${documentExtension}`;
      anchor.click();
      URL.revokeObjectURL(url);
      statusMessage = tImmediate('translate.msg.exported', { ext: documentExtension.toUpperCase() });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  /** Comic translations live as an overlay in the reader, not an exportable
   * file — send the user back to the book to see them. */
  async function goToReaderForOverlay() {
    const last = localStorage.getItem('autobook-last-item');
    const id = last ? Number(last) : NaN;
    if (!Number.isNaN(id)) {
      await goto(`${pagePath}/b?id=${id}`);
      return;
    }
    await goto(`${pagePath}${mergeEntries.MANAGE.routeId}`);
  }

  async function exportMarkdownChunks() {
    if (!translationDocument || translationDocument.format !== 'html' || !translations.size) return;
    try {
      const replacements = translationDocument.segments
        .filter((segment) => translations.has(segment.id))
        .map((segment) => ({ segmentId: segment.id, source: segment.source, target: translations.get(segment.id) || '' }));
      normalizeMarkdownChunkChars();
      const chunks = exportHtmlAsMarkdownChunks(translationDocument, replacements, { maxChars: markdownChunkChars });
      const writer = new ZipWriter(new BlobWriter('application/zip'));
      for (const chunk of chunks) await writer.add(chunk.filename, new TextReader(chunk.text));
      const archive = await writer.close();
      const url = URL.createObjectURL(archive);
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = `${translationDocument.title || 'translated'}.markdown-parts.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      statusMessage = tImmediate('translate.msg.exportedChunks', { n: chunks.length });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<svelte:head>
  <title>{$t('translate.title')}</title>
</svelte:head>

<PageHeader icon={mergeEntries.TRANSLATE.icon} titleKey="menu.translate.title" backLink={prevPage} />

<main class="mx-auto flex max-w-4xl flex-col gap-6 p-6 pt-16 xl:pt-14">

  {#if latestJob}
    <section class="rounded-lg border border-current/20 bg-current/5 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span>
          {$t('translate.resume.found', {
            title: latestJob.document.title || latestJob.id,
            done: Object.keys(latestJob.translations).length,
            total: latestJob.document.segments.length
          })}
        </span>
        <button
          class="rounded px-3 py-2"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          on:click={restoreLatestJob}
        >
          {$t('translate.resume.action')}
        </button>
        <button class="rounded border border-current/40 px-3 py-2 text-sm hover-soft" on:click={discardLatestJob}>
          {$t('translate.resume.delete')}
        </button>
      </div>
    </section>
  {/if}

  {#if checkpointWarnings.length}
    <section class="rounded-lg border border-current/40 bg-current/5 p-4 text-sm">
      <p class="font-medium">{$t('translate.warnings.title')}</p>
      <ul class="mt-1 list-disc pl-5">{#each checkpointWarnings as warning}<li>{warning}</li>{/each}</ul>
    </section>
  {/if}

  {#if translationDocument && translationJob}
    <section class="rounded-lg border border-current/20 bg-current/5 p-4" aria-live="polite">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="font-medium">{$t('translate.progress.title')}</h2>
          <p class="mt-1 text-sm opacity-70">{jobStatusLabel}{running ? $t('translate.progress.batchRunning') : ''}</p>
        </div>
        <strong class="text-xl">{progressPercent}%</strong>
      </div>
      <div class="mt-3 h-3 overflow-hidden rounded-full bg-current/20" role="progressbar" aria-label={$t('translate.progress.aria')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPercent}>
        <div class="h-full rounded-full transition-all duration-500" style="width:{progressPercent}%;background:var(--link-color,#155e75)"></div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><span class="opacity-60">{$t('translate.progress.done')}</span><p class="font-medium">{$t('translate.segments', { n: completedSegmentCount })}</p></div>
        <div><span class="opacity-60">{$t('translate.progress.remaining')}</span><p class="font-medium">{$t('translate.segments', { n: remainingSegmentCount })}</p></div>
        <div><span class="opacity-60">Ollama</span><p class="truncate font-medium" title={runtimeMessage}>{runtimeMessage}</p></div>
        <div><span class="opacity-60">{$t('translate.progress.checkpoint')}</span><p class="font-medium">{$t('translate.progress.autoSaved')}</p></div>
      </div>
      {#if statusMessage}<p class="mt-3 text-sm opacity-80">{statusMessage}</p>{/if}
      {#if errorMessage}<p class="mt-3 text-sm" style="color:var(--danger-color);">{errorMessage}</p>{/if}
    </section>
  {/if}

  {#if enteredFromBook}
    <section class="rounded-lg border border-current/20 p-4">
      <h2 class="font-medium">{$t('translate.book.title')}</h2>
      <p class="mt-1 text-sm opacity-70">{activeFileName}</p>
      {#if loading}
        <p class="mt-3 text-sm opacity-70">
          {#if comicOcrProgress}
            {$t('translate.comic.ocr', { done: comicOcrProgress.page + (comicOcrProgress.cached ? 1 : 0), total: comicOcrProgress.total })}
            <span class="ml-2 inline-block h-1.5 rounded-full" style="width:{Math.round(((comicOcrProgress.page + 1) / comicOcrProgress.total) * 100)}%;background:var(--link-color);"></span>
          {:else}
            {statusMessage || $t('translate.import.parsing')}
          {/if}
        </p>
      {/if}
      {#if translationDocument}
        <dl class="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt class="opacity-60">{$t('translate.doc.title')}</dt><dd>{translationDocument.title || $t('translate.doc.untitled')}</dd>
          <dt class="opacity-60">{$t('translate.doc.language')}</dt><dd>{translationDocument.sourceLanguage || $t('translate.doc.unknownLanguage')}</dd>
          <dt class="opacity-60">{$t('translate.doc.segments')}</dt><dd>{translationDocument.segments.length}</dd>
          <dt class="opacity-60">{$t('translate.doc.id')}</dt><dd class="break-all">{translationDocument.id}</dd>
        </dl>
      {/if}
      {#if statusMessage && !loading}<p class="mt-3 text-sm opacity-80">{statusMessage}</p>{/if}
      {#if errorMessage}<p class="mt-3 text-sm" style="color:var(--danger-color);">{errorMessage}</p>{/if}
      <button class="mt-3 text-sm opacity-50 hover:opacity-100 hover-soft rounded px-2 py-1" on:click={() => { enteredFromBook = false; }}>{$t('translate.book.pickAnother')}</button>
    </section>
  {:else}
    <section class="rounded-lg border border-current/20 p-4">
      <h2 class="font-medium">{$t('translate.import.title')}</h2>
      <input class="mt-3 block w-full" type="file" multiple accept=".epub,.html,.htm,.txt,.text,.md,.markdown,.cbz,.cbr" on:change={inspect} />
      <label class="mt-3 block text-sm opacity-70">{$t('translate.import.folder')}
        <input class="mt-1 block w-full" type="file" multiple use:inputAllowDirectory on:change={inspect} />
      </label>
      {#if importQueue.length > 1}
        <div class="mt-3 rounded border border-current/20 p-3 text-sm">
          <p class="opacity-70">{$t('translate.import.queued', { n: importQueue.length, name: activeFileName || importQueue[0]?.name || '' })}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each importQueue as queuedFile}
              <button class="rounded border border-current/20 px-2 py-1 hover-soft" class:bg-soft-active={queuedFile.name === activeFileName} on:click={() => inspectFile(queuedFile)}>{queuedFile.name}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if loading}
        <p class="mt-3 text-sm opacity-70">
          {#if comicOcrProgress}
            {$t('translate.comic.ocr', { done: comicOcrProgress.page + (comicOcrProgress.cached ? 1 : 0), total: comicOcrProgress.total })}
            <span class="ml-2 inline-block h-1.5 rounded-full" style="width:{Math.round(((comicOcrProgress.page + 1) / comicOcrProgress.total) * 100)}%;background:var(--link-color);"></span>
          {:else}
            {statusMessage || $t('translate.import.parsing')}
          {/if}
        </p>
      {/if}
      {#if translationDocument}
        <dl class="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt class="opacity-60">{$t('translate.doc.title')}</dt><dd>{translationDocument.title || $t('translate.doc.untitled')}</dd>
          <dt class="opacity-60">{$t('translate.doc.language')}</dt><dd>{translationDocument.sourceLanguage || $t('translate.doc.unknownLanguage')}</dd>
          <dt class="opacity-60">{$t('translate.doc.segments')}</dt><dd>{translationDocument.segments.length}</dd>
          <dt class="opacity-60">{$t('translate.doc.id')}</dt><dd class="break-all">{translationDocument.id}</dd>
        </dl>
      {/if}
    </section>
  {/if}

  {#if pendingComicOcr}
    <section class="rounded-lg border border-current/20 bg-current/5 p-4">
      <h2 class="font-medium">{$t('translate.comic.ocrTitle')}</h2>
      <p class="mt-1 text-sm opacity-70">{$t('translate.comic.pendingOcr', { pages: pendingComicOcr.blobs.length })}</p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="block text-sm">
          <span class="opacity-70">{$t('settings.translate.ocrLang')}</span>
          <select class={inputClasses} value={ocrLangForBook(pendingComicOcr.book)} on:change={onComicOcrLangChange}>
            {#each OCR_LANGUAGE_OPTIONS as lang (lang.code)}
              <option value={lang.code} disabled={!isOcrLanguageSupported(lang.code, activeOcrProfile)}>
                {$t(lang.labelKey)}{isOcrLanguageSupported(lang.code, activeOcrProfile) ? '' : `（${$t('settings.ocr.unsupported')}）`}
              </option>
            {/each}
          </select>
        </label>
        <div class="flex flex-col gap-2 text-sm">
          <label class="flex items-center gap-2">
            <input type="checkbox" bind:checked={$translateComicAutoOcr$} />
            {$t('settings.translate.comicAutoOcr')}
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" bind:checked={comicSkipCover} />
            {$t('translate.comic.skipCover')}
          </label>
          <label class="flex items-center gap-2">
            <input type="checkbox" bind:checked={comicSkipBackCover} />
            {$t('translate.comic.skipBackCover')}
          </label>
        </div>
      </div>
      <!-- The OCR step is the whole point of this card: it stays on screen
           with a visible progress bar even before the user starts, so a
           book that needs OCR announces "next step: OCR" up front. -->
      <div class="mt-4">
        {#if comicOcrProgress}
          <div class="flex items-center justify-between text-sm">
            <span>
              {$t('translate.comic.ocr', { done: comicOcrProgress.page + (comicOcrProgress.cached ? 1 : 0), total: comicOcrProgress.total })}
              {#if comicOcrProgress.cached}<span class="opacity-60">· {$t('translate.comic.cached')}</span>{/if}
            </span>
            <span class="tabular-nums">{Math.round(((comicOcrProgress.page + 1) / comicOcrProgress.total) * 100)}%</span>
          </div>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-current/20" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(((comicOcrProgress.page + 1) / comicOcrProgress.total) * 100)}>
            <div class="h-full rounded-full transition-all duration-300" style="width:{Math.round(((comicOcrProgress.page + 1) / comicOcrProgress.total) * 100)}%;background:var(--link-color,#155e75);"></div>
          </div>
        {:else if loading}
          <p class="text-sm opacity-70">{statusMessage || $t('translate.import.parsing')}</p>
        {:else}
          <button
            class="rounded px-3 py-2 text-sm disabled:opacity-50"
            style="background:var(--menu-background);color:var(--menu-foreground);"
            disabled={busy}
            on:click={() => { if (pendingComicOcr) runComicOcr(pendingComicOcr.blobs, pendingComicOcr.title, pendingComicOcr.fmt, pendingComicOcr.book); }}
          >
            {$t('translate.comic.runOcr')}
          </button>
        {/if}
      </div>
    </section>
  {/if}

  {#if glossaryCandidates.length || worldGlossary.length}
    <section class="rounded-lg border border-current/20 p-4">
      <h2 class="font-medium">{$t('translate.glossary.title')}</h2>
      <p class="mt-1 text-sm opacity-70">{$t('translate.glossary.hint')}</p>
      <div class="mt-3 rounded border border-current/20 bg-current/5 p-3 text-sm">
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={reuseWorldGlossary} on:change={toggleWorldGlossaryReuse} />
          {$t('translate.glossary.reuse', { n: worldGlossary.length })}
        </label>
        <label class="mt-2 flex items-center gap-2">
          <input type="checkbox" bind:checked={saveToWorldGlossary} on:change={saveGlossarySettings} />
          {$t('translate.glossary.save')}
        </label>
      </div>
      <div class="mt-3 max-h-80 overflow-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b border-current/20 text-left"><th class="p-2">{$t('translate.glossary.colSource')}</th><th class="p-2">{$t('translate.glossary.colCount')}</th><th class="p-2">{$t('translate.glossary.colTarget')}</th></tr></thead>
          <tbody>
            {#each glossaryCandidates as candidate}
              <tr class="border-b border-current/10">
                <td class="p-2">{candidate.source}</td>
                <td class="p-2 opacity-60">{candidate.occurrences}</td>
                <td class="p-2"><input class={inputClasses} value={glossaryTargets[candidate.source]} on:input={(event) => setGlossaryTarget(candidate.source, event)} placeholder={$t('translate.glossary.placeholder')} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="rounded-lg border border-current/20 p-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h2 class="font-medium">{$t('translate.runtime.title')}</h2>
        <p class="mt-1 text-sm opacity-70">{runtimeMessage}</p>
        <p class="mt-1 text-xs opacity-50">{$t('translate.runtime.endpointHint', { url: localTranslationBaseUrl() })}</p>
      </div>
      <button class={buttonClasses} on:click={checkOllama}>{$t('translate.runtime.check')}</button>
    </div>
    {#if models.length}
      <ul class="mt-4 list-disc pl-5 text-sm">
        {#each models as model}<li>{model.id}</li>{/each}
      </ul>
    {/if}
  </section>

  {#if translationDocument}
    <section class="rounded-lg border border-current/20 p-4">
      <h2 class="font-medium">{$t('translate.draft.title')}</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        <div class="text-sm">
          <span class="flex items-center gap-1">
            {$t('translate.draft.model')}
            {#if draftSourceOverridden}
              <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('draftSource')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
              </button>
            {/if}
          </span>
          <select class={inputClasses} bind:value={$translateDraftSource$}>
            <option value="local">{$t('translate.source.local')}</option>
            <option value="cloud">{$t('translate.source.cloud')}</option>
          </select>
        </div>
        {#if !draftIsCloud}
          <div class="text-sm">
            <span class="flex items-center gap-1">
              Ollama
              {#if localModelOverridden}
                <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('localModel')}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
                </button>
              {/if}
            </span>
            <select class={inputClasses} bind:value={selectedModel} on:change={() => (modelSelectionTouched = true)}>{#each models as model}<option value={model.id}>{model.id}</option>{/each}</select>
          </div>
        {/if}
        <div class="text-sm">
          <span class="flex items-center gap-1">
            {$t('translate.draft.targetLanguage')}
            {#if targetLangOverridden}
              <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('targetLanguage')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
              </button>
            {/if}
          </span>
          <input class={inputClasses} bind:value={targetLanguage} />
        </div>
      </div>
      {#if draftIsCloud}
        {#if cloudReady}
          <p class="mt-3 text-sm opacity-70">{$t('translate.source.cloudUsing', { provider: cloudProvider, model: cloudModel })}</p>
        {:else}
          <p class="mt-3 text-sm" style="color:var(--danger-color);">{$t('translate.source.cloudNotReady')}</p>
        {/if}
      {/if}
      {#if translationDocument.format === 'html'}
        <div class="mt-3 text-sm">
          <span class="flex items-center gap-1">
            {$t('translate.draft.chunkChars')}
            {#if chunkCharsOverridden}
              <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('chunkChars')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
              </button>
            {/if}
          </span>
          <input class={inputClasses} type="number" min="4000" max="100000" step="1000" bind:value={markdownChunkChars} on:change={normalizeMarkdownChunkChars} />
        </div>
      {/if}
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          class="rounded px-3 py-2 text-sm disabled:opacity-50"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          disabled={busy || !draftReady}
          on:click={startDraftTranslation}
        >
          {translationJob?.status === 'paused' || translationJob?.status === 'failed' ? $t('translate.draft.resume') : $t('translate.draft.start')}
        </button>
        <button class="rounded border border-current/40 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={!running} on:click={pauseTranslation}>{$t('translate.draft.pause')}</button>
        {#if translationDocument.format !== 'cbz' && translationDocument.format !== 'cbr'}
          <button class="rounded border border-current/20 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={!translations.size || busy} on:click={exportDraft}>{$t('translate.draft.export')}</button>
        {:else}
          <button class="rounded border border-current/20 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={!translations.size || busy} on:click={goToReaderForOverlay}>{$t('translate.draft.viewOverlay')}</button>
        {/if}
        {#if translationDocument.format === 'html'}
          <button class="rounded border border-current/20 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={!translations.size || busy} on:click={exportMarkdownChunks}>{$t('translate.draft.exportChunks')}</button>
        {/if}
      </div>
      {#if statusMessage}<p class="mt-3 text-sm opacity-70">{statusMessage}</p>{/if}
      {#if translations.size}
        <div class="mt-4 max-h-96 overflow-auto space-y-3">
          {#each translationDocument.segments.filter((segment) => translations.has(segment.id)).slice(0, 30) as segment}
            <div class="rounded border border-current/20 p-2 text-sm"><p class="opacity-60">{segment.source}</p><p class="mt-1">{translations.get(segment.id)}</p></div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if translationDocument && translations.size}
    <section class="rounded-lg border border-current/20 p-4">
      <h2 class="font-medium">{$t('translate.precision.title')}</h2>
      <p class="mt-1 text-sm opacity-70">{$t('translate.precision.hint')}</p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div class="text-sm">
          <span class="flex items-center gap-1">
            {$t('translate.draft.model')}
            {#if reviewSourceOverridden}
              <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('reviewSource')}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
              </button>
            {/if}
          </span>
          <select class={inputClasses} bind:value={$translateReviewSource$}>
            <option value="local">{$t('translate.source.local')}</option>
            <option value="cloud">{$t('translate.source.cloud')}</option>
          </select>
        </div>
        {#if !reviewIsCloud}
          <div class="text-sm">
            <span class="flex items-center gap-1">
              Ollama
              {#if localModelOverridden}
                <button class="inline-flex opacity-50 hover:opacity-100" title={$t('translate.override.reset')} on:click={() => resetField('localModel')}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="h-3 w-3"><path d="M13.5 3.5a.5.5 0 0 0-.5.5v.3l-.7-.7a5 5 0 1 0 .2 7.3.5.5 0 1 0-.7-.7 4 4 0 1 1-.2-5.8l.7.7H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5z"/></svg>
                </button>
              {/if}
            </span>
            <select class={inputClasses} bind:value={reviewLocalModel}>{#each models as model}<option value={model.id}>{model.id}</option>{/each}</select>
          </div>
        {/if}
      </div>
      {#if reviewIsCloud}
        {#if cloudReady}
          <p class="mt-3 text-sm opacity-70">{$t('translate.source.cloudUsing', { provider: cloudProvider, model: cloudModel })}</p>
        {:else}
          <p class="mt-3 text-sm" style="color:var(--danger-color);">{$t('translate.source.cloudNotReady')}</p>
        {/if}
      {/if}
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="rounded border border-current/20 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={busy || !precisionReady} on:click={checkReviewProvider}>{$t('translate.precision.check')}</button>
        <button
          class="rounded px-3 py-2 text-sm disabled:opacity-50"
          style="background:var(--menu-background);color:var(--menu-foreground);"
          disabled={busy || !precisionReady}
          on:click={startPrecisionReview}
        >
          {$t('translate.precision.start')}
        </button>
      </div>
      {#if precisionMessage}<p class="mt-3 text-sm opacity-70">{precisionMessage}</p>{/if}
    </section>
  {/if}

  {#if errorMessage}<p class="rounded border border-current/20 p-3 text-sm" style="color:var(--danger-color);">{errorMessage}</p>{/if}
</main>
