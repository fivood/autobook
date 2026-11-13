/**
 * Archived books: put away rather than deleted.
 *
 * Deleting a book to get it off the grid destroys the copy; archiving is the
 * non-destructive version of the same intent — "I finished this" or "I am not
 * going back to this", without losing the book itself.
 *
 * Keyed by title, not by book id — see the note on the `archived` store in
 * books-db-v14. In-memory cache mirroring the pattern in library-folders.ts.
 */

import { BehaviorSubject } from 'rxjs';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import { database } from '$lib/data/store';

export const archivedTitles$ = new BehaviorSubject<Set<string>>(new Set());

/**
 * The library filter value that shows the archive. Lives alongside
 * `activeFolderFilter$`'s "all" / "uncategorized" / folder-id values rather
 * than being a second dimension: archived books are hidden from every other
 * view, so "in the archive" and "in folder X" are never asked together.
 */
export const ARCHIVED_FILTER = 'archived';

export const lastArchiveEntryPoint$ = writableStringLocalStorageSubject()(
  'lastArchiveEntryPoint',
  'all'
);

export async function refreshArchive() {
  const db = await database.db;
  const rows = await db.getAll('archived');
  archivedTitles$.next(new Set(rows.map((row) => row.title)));
}

export async function archiveBooks(titles: string[]) {
  if (!titles.length) return;
  const db = await database.db;
  const tx = db.transaction('archived', 'readwrite');
  const now = Date.now();
  for (const title of titles) {
    await tx.store.put({ title, archivedAt: now });
  }
  await tx.done;
  await refreshArchive();
}

export async function unarchiveBooks(titles: string[]) {
  if (!titles.length) return;
  const db = await database.db;
  const tx = db.transaction('archived', 'readwrite');
  for (const title of titles) {
    await tx.store.delete(title);
  }
  await tx.done;
  await refreshArchive();
}

/**
 * Forget a title's archive row. Called when the book is deleted for real —
 * unlike reading records, an archive flag with no book is meaningless, and
 * leaving it would silently hide the book if it were ever re-imported.
 */
export async function clearArchiveForTitles(titles: string[]) {
  await unarchiveBooks(titles);
}
