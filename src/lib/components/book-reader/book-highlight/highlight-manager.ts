import { writable } from 'svelte/store';
import type { BooksDbHighlight, HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
import type { DatabaseService } from '$lib/data/database/books-db/database.service';

export const highlights$ = writable<BooksDbHighlight[]>([]);

let currentDataId = -1;
let currentBookTitle = '';
let dbService: DatabaseService | undefined;

export function initHighlightManager(db: DatabaseService, dataId: number, bookTitle: string) {
  dbService = db;
  currentDataId = dataId;
  currentBookTitle = bookTitle;
  loadHighlights();
}

export function disposeHighlightManager() {
  currentDataId = -1;
  dbService = undefined;
  highlights$.set([]);
}

async function loadHighlights() {
  if (!dbService || currentDataId < 0) return;
  const list = await dbService.getHighlights(currentDataId);
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
