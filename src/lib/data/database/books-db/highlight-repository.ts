/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Highlight + highlight-folder store access, extracted from database.service.ts
 * (god-service decomposition — CLAUDE.md "不要往巨石文件里继续堆代码"). The service
 * holds one instance and exposes thin facade methods over it, so existing
 * `database.addHighlight(...)` call sites are unchanged.
 *
 * storeHighlightsForTitle stays in the service: it bridges into the data store
 * via getDataByTitle, so it isn't a pure highlight concern.
 */

import type { IDBPDatabase } from 'idb';
import { Subject } from 'rxjs';
import type {
  BooksDbHighlight,
  BooksDbHighlightFolder
} from '$lib/data/database/books-db/versions/books-db';
import type BooksDb from '$lib/data/database/books-db/versions/books-db';

export class HighlightRepository {
  constructor(
    private readonly db: Promise<IDBPDatabase<BooksDb>>,
    private readonly highlightsChanged$: Subject<void>
  ) {}

  async getHighlights(dataId: number): Promise<BooksDbHighlight[]> {
    const db = await this.db;
    return db.getAllFromIndex('highlight', 'dataId', dataId);
  }

  async getAllHighlights(): Promise<BooksDbHighlight[]> {
    const db = await this.db;
    return db.getAll('highlight');
  }

  async getHighlightsForTitle(title: string): Promise<BooksDbHighlight[]> {
    const db = await this.db;
    const all = await db.getAll('highlight');
    return all.filter((h) => h.bookTitle === title);
  }

  async putHighlight(highlight: BooksDbHighlight): Promise<number> {
    const db = await this.db;
    const id = await db.put('highlight', highlight);
    this.highlightsChanged$.next();
    return id;
  }

  async addHighlight(highlight: Omit<BooksDbHighlight, 'id'>): Promise<number> {
    const db = await this.db;
    const id = await db.add('highlight', highlight as BooksDbHighlight);
    this.highlightsChanged$.next();
    return id;
  }

  async deleteHighlight(id: number): Promise<void> {
    const db = await this.db;
    await db.delete('highlight', id);
    this.highlightsChanged$.next();
  }

  async getHighlightFolders(): Promise<BooksDbHighlightFolder[]> {
    const db = await this.db;
    const list = await db.getAll('highlightFolder');
    return list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  async addHighlightFolder(name: string, parentId?: number): Promise<number> {
    const db = await this.db;
    const existing = await db.getAll('highlightFolder');
    const sortOrder = existing.length
      ? Math.max(...existing.map((f) => f.sortOrder)) + 1
      : 0;
    const now = Date.now();
    const id = await db.add('highlightFolder', {
      name,
      ...(parentId !== undefined ? { parentId } : {}),
      sortOrder,
      createdAt: now,
      lastModified: now
    } as BooksDbHighlightFolder);
    this.highlightsChanged$.next();
    return id;
  }

  async renameHighlightFolder(id: number, name: string): Promise<void> {
    const db = await this.db;
    const folder = await db.get('highlightFolder', id);
    if (!folder) return;
    await db.put('highlightFolder', { ...folder, name, lastModified: Date.now() });
    this.highlightsChanged$.next();
  }

  async deleteHighlightFolder(id: number): Promise<void> {
    const db = await this.db;
    const all = await db.getAll('highlight');
    const tx = db.transaction(['highlight', 'highlightFolder'], 'readwrite');
    for (const h of all) {
      if (h.folderId === id) {
        const { folderId: _drop, ...rest } = h;
        await tx.objectStore('highlight').put(rest as BooksDbHighlight);
      }
    }
    await tx.objectStore('highlightFolder').delete(id);
    await tx.done;
    this.highlightsChanged$.next();
  }

  async setHighlightFolder(highlightId: number, folderId: number | undefined): Promise<void> {
    const db = await this.db;
    const h = await db.get('highlight', highlightId);
    if (!h) return;
    const updated: BooksDbHighlight = {
      ...h,
      lastModified: Date.now()
    };
    if (folderId === undefined) delete updated.folderId;
    else updated.folderId = folderId;
    await db.put('highlight', updated);
    this.highlightsChanged$.next();
  }

  async linkHighlights(aId: number, bId: number): Promise<void> {
    if (aId === bId) return;
    const db = await this.db;
    const tx = db.transaction('highlight', 'readwrite');
    const [a, b] = await Promise.all([
      tx.store.get(aId),
      tx.store.get(bId)
    ]);
    if (!a || !b) {
      await tx.done;
      return;
    }
    const now = Date.now();
    const aLinks = new Set(a.linkedIds || []);
    const bLinks = new Set(b.linkedIds || []);
    aLinks.add(bId);
    bLinks.add(aId);
    await tx.store.put({ ...a, linkedIds: [...aLinks], lastModified: now });
    await tx.store.put({ ...b, linkedIds: [...bLinks], lastModified: now });
    await tx.done;
    this.highlightsChanged$.next();
  }

  async unlinkHighlights(aId: number, bId: number): Promise<void> {
    const db = await this.db;
    const tx = db.transaction('highlight', 'readwrite');
    const [a, b] = await Promise.all([
      tx.store.get(aId),
      tx.store.get(bId)
    ]);
    const now = Date.now();
    if (a) {
      const next = (a.linkedIds || []).filter((id) => id !== bId);
      await tx.store.put({ ...a, linkedIds: next.length ? next : undefined, lastModified: now });
    }
    if (b) {
      const next = (b.linkedIds || []).filter((id) => id !== aId);
      await tx.store.put({ ...b, linkedIds: next.length ? next : undefined, lastModified: now });
    }
    await tx.done;
    this.highlightsChanged$.next();
  }

  async markHighlightReviewed(id: number): Promise<void> {
    const db = await this.db;
    const h = await db.get('highlight', id);
    if (!h) return;
    const now = Date.now();
    await db.put('highlight', { ...h, lastReviewedAt: now, lastModified: now });
    this.highlightsChanged$.next();
  }
}
