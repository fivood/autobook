/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';
import type { BookCardId } from '$lib/data/book-id';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { MergeMode } from '$lib/data/merge-mode';
import { TauriFsStorageHandler } from '$lib/data/storage/handler/tauri-fs-handler';
import { StorageKey } from '$lib/data/storage/storage-types';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';
import { database } from '$lib/data/store';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { pickQuote, type QuoteBlock } from '$lib/functions/random-quote';

export interface QuoteCandidate {
  id: BookCardId;
  title: string;
}

export interface RandomQuote extends QuoteCandidate {
  text: string;
  pos: number;
}

/**
 * Split a book's HTML into paragraph-level blocks, each tagged with the
 * reader's character count at its start.
 *
 * Counting goes through `getParagraphNodes` + `getCharacterCount`, the exact
 * pair the reader's position calculators use. The stored `book.characters`
 * is no substitute: the loaders fill it by stripping tags and counting every
 * code point, punctuation and whitespace included, while the reader counts
 * only letters and ideographs — a position in one basis lands pages away in
 * the other.
 *
 * ponytail: parses the whole book to reach its first 15%; an 85-in-1 omnibus
 * costs about a second. Cut the parse at the section covering 15% if that
 * starts to show.
 */
export function extractQuoteBlocks(html: string): { blocks: QuoteBlock[]; total: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Ruby readings are not counted by the reader and would read as garbage
  // run inline with the base text.
  doc.querySelectorAll('rt, rp').forEach((el) => el.remove());

  const blocks: QuoteBlock[] = [];
  let total = 0;
  let current: Element | null = null;
  for (const node of getParagraphNodes(doc.body)) {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const block = el?.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, div') ?? null;
    if (block && block !== current) {
      blocks.push({ text: (block.textContent || '').replace(/\s+/g, ' ').trim(), pos: total });
    }
    current = block;
    total += getCharacterCount(node);
  }
  return { blocks, total };
}

/**
 * The book's HTML, wherever it lives. Under browser storage that is the IDB
 * row. Under external file storage the IDB row is a stub without
 * `elementHtml` (or missing, for a book never opened on this machine) and the
 * content is the `bookdata_*.zip` in the library folder — the same unpack the
 * reader does when it opens the book.
 */
async function loadBookHtml(
  candidate: QuoteCandidate,
  storageSource: StorageKey
): Promise<Omit<BooksDbBookData, 'id'> | undefined> {
  const local = await database.getDataByTitle(candidate.title);
  if (local?.elementHtml || storageSource !== StorageKey.TAURI_FS) return local;

  const handler = fsHandler();
  handler.startContext({ id: 0, title: candidate.title, imagePath: '' });
  const book = await handler.getBook();
  return book instanceof File ? undefined : book;
}

let privateFsHandler: TauriFsStorageHandler | undefined;

/**
 * Its own instance, not `getStorageHandler`'s shared one. That singleton's
 * context is whatever the last `startContext` caller set, and this runs in
 * the background while the library page may be opening a book or syncing a
 * vault through it — interleaved awaits would read one book's files under
 * another's title.
 *
 * ponytail: `reportProgress` is static and still ticks the global progress
 * subject, so an import started mid-load sees a few stray steps. Give the
 * handler an instance-level progress sink if that ever shows.
 */
function fsHandler() {
  privateFsHandler ??= new TauriFsStorageHandler(window, StorageKey.TAURI_FS);
  privateFsHandler.updateSettings(
    window,
    true,
    ReplicationSaveBehavior.NewOnly,
    MergeMode.MERGE,
    MergeMode.MERGE,
    false,
    false,
    ''
  );
  return privateFsHandler;
}

/**
 * A random quotable paragraph from one of `candidates`. A few books are tried
 * before giving up, since some have nothing that qualifies.
 */
export async function loadRandomQuote(
  candidates: QuoteCandidate[],
  storageSource: StorageKey,
  rand: () => number = Math.random
): Promise<RandomQuote | undefined> {
  const pool = [...candidates];
  for (let attempt = 0; attempt < 5 && pool.length; attempt += 1) {
    const [candidate] = pool.splice(Math.floor(rand() * pool.length), 1);
    const book = await loadBookHtml(candidate, storageSource);
    if (!book?.elementHtml) continue;
    const ref = book.sections?.[0]?.reference || '';
    if (ref.startsWith('pdf-page-') || ref.startsWith('cbz-page-')) continue;

    const { blocks, total } = extractQuoteBlocks(book.elementHtml);
    const quote = pickQuote(blocks, total, rand);
    if (quote) return { ...candidate, text: quote.text, pos: quote.pos };
  }
  return undefined;
}
