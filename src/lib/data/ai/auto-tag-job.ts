/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Singleton runner for auto-tagging, second batch LLM task in the app.
 *
 * Same shape as ocr-correct-job on purpose — module-level state so leaving
 * the statistics panel doesn't kill the run, one job at a time, abortable.
 * That file says the abstraction should be extracted when a third batch task
 * lands and the copied structure still fits; this is the second, so it is
 * still copied. Where it differs is noted below, and those differences are
 * the evidence the eventual abstraction will need.
 *
 * The one structural difference: this job writes nothing. The OCR corrector
 * owns its output (the text layer is machine-generated either way), but tags
 * live in `manualBook`, the user-entered store. Silently filling that with
 * guesses is the exact failure the v12 store split exists to prevent — a
 * re-import must never clobber what a person typed, and neither should a
 * model. So the job accumulates suggestions and `applyAutoTags` writes only
 * what the reader ticked.
 */

import { writable, type Readable } from 'svelte/store';
import { database } from '$lib/data/store';
import { chatOnce, type AiClientOpts } from '$lib/data/ai/ai-client';
import {
  batchTaggableBooks,
  buildTagSystemPrompt,
  buildTagUserPrompt,
  collectTagVocabulary,
  mergeTags,
  newTagsOnly,
  normalizeSubjectTags,
  parseTagResponse,
  type TaggableBook
} from '$lib/data/ai/auto-tag';

/** What the caller knows about a book before any tagging happens. */
export interface AutoTagInput {
  title: string;
  author?: string;
  publisher?: string;
  language?: string;
  /** Raw `bookMetadata.subjects` — normalised here, not by the caller. */
  subjects?: string[];
  /** Current `manualBook.tags`; suggestions are diffed against these. */
  existingTags?: string[];
}

export interface AutoTagSuggestion {
  title: string;
  existingTags: string[];
  /** From `subjects`. Present with or without a model. */
  baselineTags: string[];
  /** From the model. Empty until the model pass runs — or if it declined. */
  modelTags: string[];
  /** Baseline ∪ model, minus what's already stored. What "apply" would add. */
  newTags: string[];
}

export type AutoTagStatus = 'running' | 'finished' | 'errored';

export interface AutoTagProgress {
  batch: number;
  totalBatches: number;
  booksTagged: number;
  totalBooks: number;
}

export interface AutoTagJobState {
  modelId: string;
  status: AutoTagStatus;
  progress: AutoTagProgress;
  failedBatches: number;
  suggestions: AutoTagSuggestion[];
  error?: string;
  startedAt: number;
}

let abortCtrl: AbortController | undefined;
const _store = writable<AutoTagJobState | null>(null);

export const autoTagJob$: Readable<AutoTagJobState | null> = _store;

export function isAutoTagJobRunning(): boolean {
  return !!abortCtrl;
}

export function abortAutoTagJob() {
  abortCtrl?.abort();
}

export function clearAutoTagJob() {
  _store.set(null);
}

function toSuggestion(input: AutoTagInput, modelTags: string[] = []): AutoTagSuggestion {
  const existingTags = input.existingTags ?? [];
  const baselineTags = normalizeSubjectTags(input.subjects);
  return {
    title: input.title,
    existingTags,
    baselineTags,
    modelTags,
    newTags: newTagsOnly(existingTags, [...baselineTags, ...modelTags])
  };
}

/**
 * Layer 1 on its own — no model, no network, no job. This is what the panel
 * shows when nothing is configured, and it is why the feature is useful on a
 * machine that will never run a model.
 *
 * Books with nothing to add are dropped rather than listed with an empty
 * row: the review list should be things to decide on, not an inventory.
 */
export function computeBaselineSuggestions(inputs: readonly AutoTagInput[]): AutoTagSuggestion[] {
  return inputs.map((input) => toSuggestion(input)).filter((s) => s.newTags.length > 0);
}

/**
 * Books worth sending to the model. A book whose subject block already
 * produced tags is skipped — the file's own metadata is better evidence than
 * a model working from a title, and skipping them is most of the cost saved
 * on a library that imports well-formed EPUBs.
 */
export function selectBooksNeedingModel(inputs: readonly AutoTagInput[]): AutoTagInput[] {
  return inputs.filter(
    (input) =>
      normalizeSubjectTags(input.subjects).length === 0 && (input.existingTags?.length ?? 0) === 0
  );
}

export function startAutoTagJob(inputs: readonly AutoTagInput[], opts: AiClientOpts): boolean {
  if (abortCtrl) return false;

  const pending = selectBooksNeedingModel(inputs);
  if (!pending.length) return false;

  // Vocabulary comes from the whole library, not just the books being
  // tagged: the point is to reuse wording that already exists, and the books
  // being tagged are by definition the ones with no tags yet.
  const vocabulary = collectTagVocabulary([
    ...inputs.map((input) => input.existingTags),
    ...inputs.map((input) => normalizeSubjectTags(input.subjects))
  ]);

  const taggable: TaggableBook[] = pending.map((input, index) => ({
    index,
    title: input.title,
    author: input.author,
    publisher: input.publisher,
    language: input.language,
    subjectTags: []
  }));
  const batches = batchTaggableBooks(taggable);

  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;

  // Books the model isn't being asked about still belong in the review list
  // with their baseline tags — otherwise running the model pass would look
  // like it lost the rows the baseline had already found.
  const pendingSet = new Set<AutoTagInput>(pending);
  const skipped = inputs.filter((input) => !pendingSet.has(input));

  _store.set({
    modelId: opts.model,
    status: 'running',
    progress: { batch: 0, totalBatches: batches.length, booksTagged: 0, totalBooks: pending.length },
    failedBatches: 0,
    suggestions: computeBaselineSuggestions(skipped),
    startedAt: Date.now()
  });

  (async () => {
    const modelTagsByIndex = new Map<number, string[]>();
    let failedBatches = 0;

    const publish = (batchIndex: number) => {
      const fromModel = pending
        .map((input, index) => toSuggestion(input, modelTagsByIndex.get(index) ?? []))
        .filter((s) => s.newTags.length > 0);
      _store.update((s) =>
        s
          ? {
              ...s,
              failedBatches,
              suggestions: [...computeBaselineSuggestions(skipped), ...fromModel],
              progress: {
                ...s.progress,
                batch: batchIndex,
                booksTagged: [...modelTagsByIndex.values()].filter((tags) => tags.length).length
              }
            }
          : s
      );
    };

    try {
      const system = buildTagSystemPrompt(vocabulary);

      for (let i = 0; i < batches.length; i += 1) {
        if (signal.aborted) break;
        const batch = batches[i];
        if (!batch) continue;

        try {
          const raw = await chatOnce(opts, {
            system,
            messages: [{ role: 'user', content: buildTagUserPrompt(batch) }],
            maxTokens: 1024,
            jsonMode: true,
            signal
          });
          const parsed = parseTagResponse(raw, batch);
          for (const [index, tags] of parsed) modelTagsByIndex.set(index, tags);
          if (!parsed.size) failedBatches += 1;
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          // One bad batch must not sink the run; those books simply keep
          // whatever the baseline gave them and can be re-run.
          failedBatches += 1;
        }

        publish(i + 1);
      }

      _store.update((s) => (s ? { ...s, status: 'finished', failedBatches } : s));
    } catch (err: any) {
      const aborted = err?.name === 'AbortError' || signal.aborted;
      // Whatever was gathered before the abort is already in the store —
      // every completed batch published as it landed, and a partial review
      // list is still worth looking at.
      _store.update((s) =>
        s
          ? {
              ...s,
              status: aborted ? 'finished' : 'errored',
              failedBatches,
              error: aborted ? undefined : err?.message || String(err)
            }
          : s
      );
    } finally {
      abortCtrl = undefined;
    }
  })();

  return true;
}

export interface ApplyAutoTagsResult {
  booksUpdated: number;
  tagsAdded: number;
}

/**
 * Write accepted suggestions into `manualBook.tags`.
 *
 * `upsertManualBook` merges field-by-field, so a title that has no manualBook
 * row yet gets one holding only tags, and a title that has one keeps its
 * author / cover / character count untouched. Re-reads the stored tags at
 * write time rather than trusting the snapshot in the suggestion: the review
 * list can sit on screen for a while, and the manual entry dialog may have
 * edited the same title in the meantime.
 */
export async function applyAutoTags(
  accepted: readonly { title: string; tags: string[] }[]
): Promise<ApplyAutoTagsResult> {
  let booksUpdated = 0;
  let tagsAdded = 0;

  for (const entry of accepted) {
    if (!entry.tags.length) continue;
    const existing = await database.getManualBook(entry.title);
    const merged = mergeTags(existing?.tags, entry.tags);
    if (merged.length === (existing?.tags?.length ?? 0)) continue;
    tagsAdded += merged.length - (existing?.tags?.length ?? 0);
    await database.upsertManualBook({ ...(existing ?? {}), title: entry.title, tags: merged });
    booksUpdated += 1;
  }

  return { booksUpdated, tagsAdded };
}
