/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import type {
  BooksDbBookmarkData,
  BooksDbHighlight
} from '$lib/data/database/books-db/versions/books-db';
import { MergeMode } from '$lib/data/merge-mode';
import { TauriFsStorageHandler } from '$lib/data/storage/handler/tauri-fs-handler';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageKey } from '$lib/data/storage/storage-types';
import { database, startDayHoursForTracker$ } from '$lib/data/store';
import { titleFromKindleFilename } from '$lib/functions/random-quote';
import {
  findHighlightOffset,
  parseSidecar,
  sessionsToStatistics,
  type KoBook
} from '$lib/functions/koreader';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

interface KoDataRaw {
  books: KoBook[];
  sidecars: { path: string; lua: string }[];
}

export interface KoImportResult {
  books: number;
  days: number;
  highlights: number;
  progress: number;
  skipped: string[];
}

/**
 * Read the KOReader dataset off a Kindle root and merge it into AutoBook.
 *
 * Everything routes through the ACTIVE storage handler, not the IDB
 * database directly. Under external file storage a book has no IDB `data`
 * row until it has been opened locally — so a direct `database.putBookmark`
 * would either silently fail (no dataId) or write to the wrong id space
 * ([[autobook-id-spaces]]); the handler writes `progress_*.json` /
 * `statistics_*.json` / `highlights_*.json` next to the book on disk.
 *
 * Book matching is by title. `partial_md5_checksum` from KOReader is
 * ignored — AutoBook has no md5 index, and adding one for a handful of
 * Kindle books is not worth it.
 *
 * ponytail: only imports for books the AutoBook library already knows about.
 * Kindle-only books are reported in `skipped` so the user can import them
 * first via 从 Kindle 导入.
 */
export async function importFromKoreader(
  kindleRoot: string,
  cards: BookCardProps[],
  storageSource: StorageKey
): Promise<KoImportResult | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<KoDataRaw | null>('read_koreader', { root: kindleRoot });
  // Installed but never launched: no settings folder, nothing to import.
  if (!raw) return null;

  const sidecars = raw.sidecars.map((s) => parseSidecar(s.path, s.lua));
  const cardByTitle = new Map<string, BookCardProps>();
  for (const c of cards) {
    if (c.isPlaceholder) continue;
    cardByTitle.set(c.title, c);
    const stem = titleFromKindleFilename(c.title);
    if (stem !== c.title) cardByTitle.set(stem, c);
  }

  // Its own handler instance for the same reason as random-quote-loader:
  // the shared singleton's context is whatever the last caller set, and a
  // background import interleaves with the library page's own storage work.
  const handler =
    storageSource === StorageKey.TAURI_FS ? privateFsHandler() : sharedHandler(storageSource);
  const now = Date.now();

  let books = 0;
  let days = 0;
  let highlights = 0;
  let progress = 0;
  const skipped = new Set<string>();

  for (const koBook of raw.books) {
    // KOReader opens its own bundled quickstart guide on first launch, and
    // it lands in the statistics like any book. Never in the library, never
    // worth reporting.
    if (/^KOReader\b/i.test(koBook.title)) continue;
    const card = resolveCard(koBook.title, cardByTitle);
    if (!card) {
      if (koBook.sessions.some((s) => s.duration > 0)) skipped.add(koBook.title);
      continue;
    }
    const stats = sessionsToStatistics(card.title, koBook.sessions, startDayHoursForTracker$.getValue(), now);
    if (!stats.length) continue;
    handler.startContext({ id: card.id, title: card.title, imagePath: card.imagePath });
    await handler.saveStatistics(stats, now);
    books += 1;
    days += stats.length;
  }

  for (const sc of sidecars) {
    if (!sc.title && !sc.annotations.length && !sc.percentFinished) continue;
    const card =
      resolveCard(sc.title, cardByTitle) ?? matchByFilename(sc.path, cardByTitle);
    if (!card) {
      if (sc.annotations.length) skipped.add(sc.title || sc.path.split(/[\\/]/).pop() || sc.path);
      continue;
    }
    handler.startContext({ id: card.id, title: card.title, imagePath: card.imagePath });

    if (sc.percentFinished > 0 && card.characters > 0) {
      const explored = Math.round(card.characters * sc.percentFinished);
      // Never move a locally-recorded position backwards.
      const existingProgress = typeof card.progress === 'number' ? card.progress : 0;
      if (existingProgress < sc.percentFinished) {
        const bm: BooksDbBookmarkData = {
          dataId: card.id,
          exploredCharCount: explored,
          progress: sc.percentFinished,
          lastBookmarkModified: now
        };
        await handler.saveProgress(bm);
        progress += 1;
      }
    }

    if (sc.annotations.length) {
      const book = await handler.getBook();
      const html = book && !(book instanceof File) ? book.elementHtml : '';
      if (!html) continue;
      const rows: BooksDbHighlight[] = [];
      for (const ann of sc.annotations) {
        const range = findHighlightOffset(html, ann.text);
        if (!range) continue;
        const createdAt = Date.parse(ann.datetime) || now;
        rows.push({
          id: 0,
          dataId: card.id,
          bookTitle: card.title,
          startOffset: range.start,
          endOffset: range.end,
          text: ann.text,
          memo: '',
          color: '1',
          createdAt,
          lastModified: createdAt,
          tags: ['Kindle']
        });
      }
      if (rows.length) {
        // MERGE mode: read existing, union in the new ones.
        const existing = await handler.getHighlightData();
        const existingRows = Array.isArray(existing?.highlights) ? existing!.highlights! : [];
        const seen = new Set(existingRows.map((h) => `${h.startOffset}_${h.endOffset}_${h.text}`));
        const merged = [...existingRows];
        for (const row of rows) {
          const key = `${row.startOffset}_${row.endOffset}_${row.text}`;
          if (!seen.has(key)) merged.push(row);
        }
        if (merged.length !== existingRows.length) {
          await handler.saveHighlightData(merged, now);
          highlights += merged.length - existingRows.length;
          // Under browser storage the reader also reads from IDB `highlight`;
          // keep that in sync so the imported highlights show without a reload.
          if (storageSource === StorageKey.BROWSER) {
            await database.storeHighlightsForTitle(card.title, rows, ReplicationSaveBehavior.NewOnly);
          }
        }
      }
    }
  }

  // Nudge the library so imported progress and highlight counts land on the
  // cards without needing a page refresh.
  if (progress || highlights || books) database.dataListChanged$.next(handler);

  return { books, days, highlights, progress, skipped: [...skipped] };
}

function resolveCard(koTitle: string, index: Map<string, BookCardProps>): BookCardProps | undefined {
  if (!koTitle) return undefined;
  return index.get(koTitle) ?? index.get(titleFromKindleFilename(koTitle));
}

function matchByFilename(sidecarPath: string, index: Map<string, BookCardProps>): BookCardProps | undefined {
  const parts = sidecarPath.split(/[\\/]/);
  const sdrIdx = parts.findIndex((p) => p.endsWith('.sdr'));
  if (sdrIdx < 0) return undefined;
  const stem = parts[sdrIdx].replace(/\.sdr$/, '').trim();
  return index.get(stem) ?? index.get(titleFromKindleFilename(stem));
}

let cachedFsHandler: TauriFsStorageHandler | undefined;

function privateFsHandler(): TauriFsStorageHandler {
  cachedFsHandler ??= new TauriFsStorageHandler(window, StorageKey.TAURI_FS);
  cachedFsHandler.updateSettings(
    window,
    true, // isForBrowser: makes getBook() unpack the zip into a book object
    ReplicationSaveBehavior.NewOnly,
    MergeMode.MERGE,
    MergeMode.MERGE,
    false,
    false,
    ''
  );
  return cachedFsHandler;
}

function sharedHandler(storageSource: StorageKey): BaseStorageHandler {
  // Browser storage: the shared handler is fine — nothing else races on it
  // for this storage type during a Kindle import.
  return getStorageHandler(window, storageSource, '', true);
}
