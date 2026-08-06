<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
  import { adapterForTranslationDocument, checkLocalTranslationRuntime, createCloudTranslationProvider, createLocalTranslationProvider, inspectStoredBook, inspectTranslationFile, listLocalTranslationModels, localTranslationBaseUrl, type TranslationSource } from '$lib/data/translation/translation-core';
  import { aiApiKey$, aiModel$, aiProvider$, database, translateDraftSource$, translateReviewSource$ } from '$lib/data/store';
  import { DEFAULT_GLOSSARY_PROFILE_ID, getGlossaryProfile, getLatestTranslationJob, saveGlossaryProfile, saveTranslationJob } from '$lib/data/translation/translation-job-store';
  import { exportHtmlAsMarkdownChunks, extractGlossaryCandidates, translateInBatches } from 'translator-workbench';
  import { createJob, pendingSegments, recordTranslationResults, setJobStatus, validateTranslationJob } from 'translator-workbench';
  import type { DocumentAdapter, GlossaryEntry, ModelInfo, TranslationDocument, TranslationJob, TranslationResult } from 'translator-workbench';
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
  let selectedModel = '';
  let modelSelectionTouched = false;
  let targetLanguage = 'zh-CN';
  let translations = new Map<string, string>();
  let runtimeMessage = tImmediate('translate.runtime.unchecked');
  let precisionMessage = tImmediate('translate.precision.unconfigured');
  let markdownChunkChars = 24000;
  let statusMessage = '';
  let errorMessage = '';
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
  $: draftReady = draftIsCloud ? cloudReady : !!selectedModel;
  $: precisionReady = reviewIsCloud ? cloudReady : !!selectedModel;

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
      const savedChunkChars = Number(localStorage.getItem('autobook-translation-markdown-chars') || '');
      if (Number.isInteger(savedChunkChars) && savedChunkChars >= 4000) markdownChunkChars = Math.min(savedChunkChars, 100000);
      const bookId = Number($page.url.searchParams.get('bookId') || '');
      if (bookId) {
        const book = await database.getData(bookId);
        if (book) {
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

  async function inspect(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    importQueue = Array.from(input.files || []).filter((candidate) => /\.(epub|html|htm|txt|text|md|markdown)$/i.test(candidate.name));
    const file = importQueue[0];
    if (!file) return;
    await inspectFile(file);
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

  async function checkOllama() {
    errorMessage = '';
    try {
      const health = await checkLocalTranslationRuntime();
      runtimeMessage = health.message;
      models = health.ok ? await listLocalTranslationModels() : [];
      if (models.length && (!modelSelectionTouched || !models.some((model) => model.id === selectedModel))) {
        selectedModel = bestLocalModel(models);
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
      const provider = draftIsCloud ? createCloudTranslationProvider() : createLocalTranslationProvider();
      const model = draftIsCloud ? cloudModel : selectedModel;
      await translateInBatches(pendingSegments(job), {
        provider,
        model,
        sourceLanguage: translationDocument.sourceLanguage || 'en',
        targetLanguage,
        glossary: job.glossary,
        batchSize: draftIsCloud ? 6 : 3,
        maxSourceChars: 12000,
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
    localStorage.setItem('autobook-translation-markdown-chars', String(markdownChunkChars));
  }

  function reviewProvider() {
    return reviewIsCloud ? createCloudTranslationProvider() : createLocalTranslationProvider();
  }

  function reviewModel() {
    return reviewIsCloud ? cloudModel : selectedModel;
  }

  async function checkReviewProvider() {
    errorMessage = '';
    const isCloud = reviewIsCloud;
    if (isCloud && !cloudReady) {
      precisionMessage = tImmediate('translate.precision.needsSettings');
      return;
    }
    if (!isCloud && !selectedModel) {
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

<main class="mx-auto flex max-w-4xl flex-col gap-6 p-6">
  <header>
    <h1 class="text-2xl font-semibold">{$t('translate.title')}</h1>
    <p class="mt-2 text-sm opacity-70">{$t('translate.subtitle')}</p>
  </header>

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

  <section class="rounded-lg border border-current/20 p-4">
    <h2 class="font-medium">{$t('translate.import.title')}</h2>
    <input class="mt-3 block w-full" type="file" multiple accept=".epub,.html,.htm,.txt,.text,.md,.markdown" on:change={inspect} />
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
    {#if loading}<p class="mt-3 text-sm opacity-70">{$t('translate.import.parsing')}</p>{/if}
    {#if translationDocument}
      <dl class="mt-4 grid grid-cols-2 gap-2 text-sm">
        <dt class="opacity-60">{$t('translate.doc.title')}</dt><dd>{translationDocument.title || $t('translate.doc.untitled')}</dd>
        <dt class="opacity-60">{$t('translate.doc.language')}</dt><dd>{translationDocument.sourceLanguage || $t('translate.doc.unknownLanguage')}</dd>
        <dt class="opacity-60">{$t('translate.doc.segments')}</dt><dd>{translationDocument.segments.length}</dd>
        <dt class="opacity-60">{$t('translate.doc.id')}</dt><dd class="break-all">{translationDocument.id}</dd>
      </dl>
    {/if}
  </section>

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
        <label class="text-sm">{$t('translate.draft.model')}
          <select class={inputClasses} bind:value={$translateDraftSource$}>
            <option value="local">{$t('translate.source.local')}</option>
            <option value="cloud">{$t('translate.source.cloud')}</option>
          </select>
        </label>
        {#if !draftIsCloud}
          <label class="text-sm">Ollama<select class={inputClasses} bind:value={selectedModel} on:change={() => (modelSelectionTouched = true)}>{#each models as model}<option value={model.id}>{model.id}</option>{/each}</select></label>
        {/if}
        <label class="text-sm">{$t('translate.draft.targetLanguage')}<input class={inputClasses} bind:value={targetLanguage} /></label>
      </div>
      {#if draftIsCloud}
        {#if cloudReady}
          <p class="mt-3 text-sm opacity-70">{$t('translate.source.cloudUsing', { provider: cloudProvider, model: cloudModel })}</p>
        {:else}
          <p class="mt-3 text-sm" style="color:var(--danger-color);">{$t('translate.source.cloudNotReady')}</p>
        {/if}
      {/if}
      {#if translationDocument.format === 'html'}
        <label class="mt-3 block text-sm">{$t('translate.draft.chunkChars')}<input class={inputClasses} type="number" min="4000" max="100000" step="1000" bind:value={markdownChunkChars} on:change={normalizeMarkdownChunkChars} /></label>
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
        <button class="rounded border border-current/20 px-3 py-2 text-sm hover-soft disabled:opacity-50" disabled={!translations.size || busy} on:click={exportDraft}>{$t('translate.draft.export')}</button>
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
        <label class="text-sm">{$t('translate.draft.model')}
          <select class={inputClasses} bind:value={$translateReviewSource$}>
            <option value="local">{$t('translate.source.local')}</option>
            <option value="cloud">{$t('translate.source.cloud')}</option>
          </select>
        </label>
        {#if !reviewIsCloud}
          <label class="text-sm">Ollama<select class={inputClasses} bind:value={selectedModel} on:change={() => (modelSelectionTouched = true)}>{#each models as model}<option value={model.id}>{model.id}</option>{/each}</select></label>
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
