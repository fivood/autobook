import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GlossaryEntry, TranslationJob } from 'translator-workbench';
import { isTauri } from '$lib/data/env';

export interface TranslationGlossaryProfile {
  id: string;
  name: string;
  entries: GlossaryEntry[];
  updatedAt: string;
}

export const DEFAULT_GLOSSARY_PROFILE_ID = 'default-world';

interface TranslationJobDb extends DBSchema {
  jobs: {
    key: string;
    value: TranslationJob;
    indexes: {
      updatedAt: string;
      status: TranslationJob['status'];
    };
  };
  glossaries: {
    key: string;
    value: TranslationGlossaryProfile;
    indexes: {
      updatedAt: string;
    };
  };
}

let database: Promise<IDBPDatabase<TranslationJobDb>> | undefined;

function getDatabase() {
  database ??= openDB<TranslationJobDb>('autobook-translation-jobs', 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('jobs')) {
        const store = db.createObjectStore('jobs', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('glossaries')) {
        const store = db.createObjectStore('glossaries', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    }
  });
  return database;
}

export async function saveTranslationJob(job: TranslationJob): Promise<void> {
  await (await getDatabase()).put('jobs', job);
}

export async function getTranslationJob(id: string): Promise<TranslationJob | undefined> {
  return (await getDatabase()).get('jobs', id);
}

export async function getLatestTranslationJob(): Promise<TranslationJob | undefined> {
  const jobs = await (await getDatabase()).getAll('jobs');
  return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * The most recently updated image-book job (cbz/cbr) matching a book title.
 * The reader uses this to find the translation to overlay on a comic. Falls
 * back to any comic-format job when no title matches — one comic at a time
 * is the common case.
 *
 * Prefers the newest job that *has translations*: OCR re-runs create fresh
 * empty jobs (glossary-review / drafting, 0 translations) that would shadow a
 * translated one, hiding the overlay. Only when nothing translated exists do
 * we fall back to the newest job.
 */
export async function findComicTranslationJob(title?: string): Promise<TranslationJob | undefined> {
  const jobs = await (await getDatabase()).getAll('jobs');
  const sorted = jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const isComic = (job: TranslationJob) => job.document.format === 'cbz' || job.document.format === 'cbr';
  const hasOutput = (job: TranslationJob) => Object.keys(job.translations || {}).length > 0;
  if (title) {
    const byTitle = sorted.filter((job) => isComic(job) && job.document.title === title);
    const translated = byTitle.find(hasOutput);
    if (translated) return translated;
    if (byTitle.length) return byTitle[0];
  }
  const translatedAny = sorted.find((job) => isComic(job) && hasOutput(job));
  if (translatedAny) return translatedAny;
  return sorted.find(isComic);
}

export async function deleteTranslationJob(id: string): Promise<void> {
  const db = await getDatabase();
  const job = await db.get('jobs', id);
  await db.delete('jobs', id);
  // Comic jobs spill page images + OCR caches into the filesystem under a
  // *stable* cache key (title|fmt|lang, see comic-cache-key.ts), not the job
  // UUID — so the IDB delete above alone would orphan hundreds of MB. The
  // cache key rides on the job document's metadata; older jobs that predate
  // that fall back to the job id (which was the old namespace).
  if (!isTauri()) return;
  const cacheKey = job?.document?.metadata?.cacheKey || id;
  try {
    const { TauriComicStorage } = await import('./comic-storage-tauri');
    await new TauriComicStorage().deleteJob(cacheKey);
  } catch (error) {
    // The IDB row is already gone; a failed fs cleanup (locked file, etc.)
    // must not turn a user-requested delete into a visible error. Leftover
    // dirs are reclaimable manually — better than blocking the delete.
    console.warn('comic cache cleanup failed', error);
  }
}

export async function getGlossaryProfile(
  id = DEFAULT_GLOSSARY_PROFILE_ID
): Promise<TranslationGlossaryProfile | undefined> {
  return (await getDatabase()).get('glossaries', id);
}

export async function saveGlossaryProfile(profile: TranslationGlossaryProfile): Promise<void> {
  await (await getDatabase()).put('glossaries', profile);
}
