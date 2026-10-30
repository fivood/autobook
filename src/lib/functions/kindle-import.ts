/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import { kindleImportedPaths$ } from '$lib/data/store';
import type { ImportedBook } from '$lib/functions/replication/replicator';
import { kindleRelPath, pendingKindleBooks } from '$lib/functions/random-quote';

export interface KindleScan {
  root: string;
  /** `system/version.txt`, e.g. "Kindle 5.18.6 (458618 041)". */
  version: string;
  books: string[];
  /** `documents/JAILBROKEN.txt` present. */
  jailbroken: boolean;
  /** KOReader installed, whether or not it has run yet. */
  koreader: boolean;
}

/** The connected Kindle and every book file on it, or null when none is
 * plugged in. Also grants the fs scope needed to read those files. */
export async function scanKindle(): Promise<KindleScan | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<KindleScan | null>('find_kindle_books');
}

/**
 * Files per import run. A Kindle's worth of books is easily a gigabyte and
 * the import needs each one as an in-memory File, so reading them all up
 * front (what `importLaunchPaths` does for a handful of launch files) would
 * hold the lot in the renderer at once.
 */
const BATCH = 8;

export async function importFromKindle(
  scan: KindleScan,
  libraryTitles: ReadonlySet<string>,
  importFiles: (
    files: File[],
    skipTitles: ReadonlySet<string>
  ) => Promise<{ imported: ImportedBook[]; skipped: File[]; error: string }>,
  isCancelled: () => boolean
): Promise<{ imported: number; alreadyInLibrary: number; pending: number; errors: string[] }> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const done = new Set(kindleImportedPaths$.getValue());
  const pending = pendingKindleBooks(scan.books, scan.root, done, libraryTitles);
  const errors: string[] = [];
  // The filename check above misses books whose file on the Kindle was renamed
  // (or converted to epub) since they were imported — only the title inside the
  // book gives those away, and that needs the import to parse it.
  const titles = new Set([...libraryTitles].map((t) => t.trim()));
  let imported = 0;
  let alreadyInLibrary = 0;

  for (let i = 0; i < pending.length && !isCancelled(); i += BATCH) {
    const relByFile = new Map<File, string>();
    for (const path of pending.slice(i, i + BATCH)) {
      const name = path.split(/[\\/]/).pop() || path;
      try {
        relByFile.set(new File([await readFile(path)], name), kindleRelPath(path, scan.root));
      } catch (err: any) {
        errors.push(`${name}: ${err?.message ?? err}`);
      }
    }
    if (!relByFile.size) continue;

    const result = await importFiles([...relByFile.keys()], titles);
    for (const file of [...result.imported.map((b) => b.file), ...result.skipped]) {
      const rel = relByFile.get(file);
      if (rel) done.add(rel);
    }
    imported += result.imported.length;
    alreadyInLibrary += result.skipped.length;
    if (result.error) errors.push(result.error);
    // Saved per batch so an interrupted run does not redo the finished ones.
    kindleImportedPaths$.next([...done]);
  }

  return { imported, alreadyInLibrary, pending: pending.length, errors };
}
