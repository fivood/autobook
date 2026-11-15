import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';

/**
 * One bookmark row per book does two jobs: where to resume (the auto-bookmark
 * moves it every few seconds of stillness) and the place the reader marked
 * with B / 添加书签. Sharing one field, the auto-bookmark overwrote the mark
 * within seconds and 返回书签位置 had nowhere to go back to (Mac test R8).
 * The mark now rides in `manualExploredCharCount`; rows without it — anything
 * saved before this, or never marked — behave exactly as before.
 */

/** The row as the marked position, for 返回书签位置 and the on-page ribbon. */
export function manualBookmarkView(
  data: BooksDbBookmarkData | undefined
): BooksDbBookmarkData | undefined {
  if (data?.manualExploredCharCount == null) return data;
  // No scrollX / scrollY: those belong to the resume position, and the
  // continuous reader prefers them over the char count when present.
  return {
    dataId: data.dataId,
    exploredCharCount: data.manualExploredCharCount,
    progress: data.progress,
    lastBookmarkModified: data.lastBookmarkModified
  };
}

/** `next` with the mark set (manual) or carried over from `prev` (auto). */
export function withManualBookmark(
  next: BooksDbBookmarkData,
  prev: BooksDbBookmarkData | undefined,
  manual: boolean
): BooksDbBookmarkData {
  const mark = manual ? next.exploredCharCount : prev?.manualExploredCharCount;
  const { manualExploredCharCount: _drop, ...rest } = next;
  return mark == null ? rest : { ...rest, manualExploredCharCount: mark };
}
