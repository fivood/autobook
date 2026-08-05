import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GlossaryEntry, TranslationJob } from 'translator-workbench';

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

export async function deleteTranslationJob(id: string): Promise<void> {
  await (await getDatabase()).delete('jobs', id);
}

export async function getGlossaryProfile(
  id = DEFAULT_GLOSSARY_PROFILE_ID
): Promise<TranslationGlossaryProfile | undefined> {
  return (await getDatabase()).get('glossaries', id);
}

export async function saveGlossaryProfile(profile: TranslationGlossaryProfile): Promise<void> {
  await (await getDatabase()).put('glossaries', profile);
}
