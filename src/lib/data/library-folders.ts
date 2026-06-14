/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * In-memory cache of the `folder` and `bookFolder` stores, refreshed when
 * mutations happen. Tag-style: a book can live in many folders.
 */

import { BehaviorSubject } from 'rxjs';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import type { BooksDbBookFolder, BooksDbFolder } from '$lib/data/database/books-db/versions/books-db';
import { database } from '$lib/data/store';

export const folders$ = new BehaviorSubject<BooksDbFolder[]>([]);
export const bookFolders$ = new BehaviorSubject<BooksDbBookFolder[]>([]);

/** Which folder is currently filtering the library view.
 * "all" = show everything; "uncategorized" = books with no folder assignment;
 * numeric string = folder id. Persisted so it survives reload. */
export const activeFolderFilter$ = writableStringLocalStorageSubject()(
  'activeFolderFilter',
  'all'
);

async function getDb() {
  return database.db;
}

export async function refreshFolders() {
  const db = await getDb();
  const [allFolders, allBookFolders] = await Promise.all([
    db.getAll('folder'),
    db.getAll('bookFolder')
  ]);
  allFolders.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  folders$.next(allFolders);
  bookFolders$.next(allBookFolders);
}

export async function createFolder(name: string): Promise<BooksDbFolder | undefined> {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const db = await getDb();
  const existing = folders$.getValue();
  const sortOrder = existing.length
    ? Math.max(...existing.map((f) => f.sortOrder)) + 1
    : 0;
  const id = (await db.add('folder', {
    name: trimmed,
    sortOrder,
    createdAt: Date.now()
  } as BooksDbFolder)) as number;
  await refreshFolders();
  return folders$.getValue().find((f) => f.id === id);
}

export async function renameFolder(id: number, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const db = await getDb();
  const folder = await db.get('folder', id);
  if (!folder) return;
  folder.name = trimmed;
  await db.put('folder', folder);
  await refreshFolders();
}

export async function deleteFolder(id: number) {
  const db = await getDb();
  const tx = db.transaction(['folder', 'bookFolder'], 'readwrite');
  await tx.objectStore('folder').delete(id);
  const idx = tx.objectStore('bookFolder').index('folderId');
  let cursor = await idx.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  if (activeFolderFilter$.getValue() === String(id)) {
    activeFolderFilter$.next('all');
  }
  await refreshFolders();
}

export async function addBooksToFolder(bookIds: number[], folderId: number) {
  if (!bookIds.length) return;
  const db = await getDb();
  const tx = db.transaction('bookFolder', 'readwrite');
  const now = Date.now();
  for (const bookId of bookIds) {
    // put = upsert; safe even if the (book, folder) pair already exists.
    await tx.store.put({ bookId, folderId, addedAt: now });
  }
  await tx.done;
  await refreshFolders();
}

export async function removeBooksFromFolder(bookIds: number[], folderId: number) {
  if (!bookIds.length) return;
  const db = await getDb();
  const tx = db.transaction('bookFolder', 'readwrite');
  for (const bookId of bookIds) {
    await tx.store.delete([bookId, folderId]);
  }
  await tx.done;
  await refreshFolders();
}

/** Drop all folder assignments for a book — call when the book itself is
 * deleted from the library. */
export async function clearBookFolderAssignments(bookId: number) {
  const db = await getDb();
  const tx = db.transaction('bookFolder', 'readwrite');
  const idx = tx.store.index('bookId');
  let cursor = await idx.openCursor(IDBKeyRange.only(bookId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  await refreshFolders();
}
