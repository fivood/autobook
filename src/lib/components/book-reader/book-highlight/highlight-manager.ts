import { writable } from 'svelte/store';
import type { BooksDbHighlight, HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
import type { DatabaseService } from '$lib/data/database/books-db/database.service';

export const highlights$ = writable<BooksDbHighlight[]>([]);

let currentDataId = -1;
let currentBookTitle = '';
let dbService: DatabaseService | undefined;
/** Bumped per init so a slow load for the previous book cannot land on top of
 *  the current one. */
let loadToken = 0;

export function initHighlightManager(db: DatabaseService, dataId: number, bookTitle: string) {
  dbService = db;
  currentDataId = dataId;
  currentBookTitle = bookTitle;
  // Cleared synchronously. /b is a single route, so moving between two books
  // re-runs this without ever unmounting the page — dispose does not get to
  // run in between. Left alone, the previous book's highlights stay in the
  // store while the new load is in flight and the renderer paints them, by
  // offset, onto a completely different text.
  highlights$.set([]);
  loadHighlights();
}

export function disposeHighlightManager() {
  currentDataId = -1;
  currentBookTitle = '';
  dbService = undefined;
  loadToken += 1;
  highlights$.set([]);
}

async function loadHighlights() {
  if (!dbService || currentDataId < 0) return;
  const token = ++loadToken;
  const list = await dbService.getHighlights(currentDataId);
  // Two reads against different books are separate transactions and can settle
  // out of order; without this the older book's list wins and the sidebar ends
  // up listing highlights that belong to a book you are no longer in.
  if (token !== loadToken) return;
  list.sort((a, b) => a.startOffset - b.startOffset);
  highlights$.set(list);
}

export async function addHighlight(
  startOffset: number,
  endOffset: number,
  text: string,
  color: HighlightSlot,
  memo = '',
  tags: string[] = []
): Promise<BooksDbHighlight | undefined> {
  if (!dbService || currentDataId < 0) return undefined;
  const now = Date.now();
  const highlight: Omit<BooksDbHighlight, 'id'> = {
    dataId: currentDataId,
    bookTitle: currentBookTitle,
    startOffset,
    endOffset,
    text,
    memo,
    color,
    createdAt: now,
    lastModified: now,
    ...(tags.length ? { tags } : {})
  };
  const id = await dbService.addHighlight(highlight);
  const saved = { ...highlight, id } as BooksDbHighlight;
  highlights$.update((list) => {
    const next = [...list, saved];
    next.sort((a, b) => a.startOffset - b.startOffset);
    return next;
  });
  return saved;
}

export async function updateHighlight(
  id: number,
  updates: Partial<Pick<BooksDbHighlight, 'memo' | 'color' | 'tags'>>
) {
  if (!dbService) return;
  let found: BooksDbHighlight | undefined;
  highlights$.update((list) => {
    found = list.find((h) => h.id === id);
    return list;
  });
  if (!found) return;
  const updated = { ...found, ...updates, lastModified: Date.now() };
  await dbService.putHighlight(updated);
  highlights$.update((list) => list.map((h) => (h.id === id ? updated : h)));
}

export async function removeHighlight(id: number) {
  if (!dbService) return;
  await dbService.deleteHighlight(id);
  highlights$.update((list) => list.filter((h) => h.id !== id));
}
