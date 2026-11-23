import { goto } from '$app/navigation';
import { pagePath } from '$lib/data/env';

/**
 * 返回上一页 that actually goes back.
 *
 * Every page used to link its back arrow to `afterNavigate`'s `from` — a new
 * history entry pointing at the previous page. Two pages that link to each
 * other then bounce forever: 书 → 设置 → 更新记录 → ← → 设置 → ← lands on 更新记录
 * again, and the book is unreachable. Going back in history has no such loop.
 *
 * `history.back()` alone can't tell whether there is an entry to go back to
 * (the first entry after launch has none, and `history.length` also counts
 * forward entries), nor where it leads — the reader hides its arrow when the
 * way back is the library, which 书库 already covers. So the layout records
 * each entry's URL under SvelteKit's per-entry history index; sessionStorage
 * keeps that across the reader's full-page reloads, which keep the index.
 */
const STORAGE_KEY = 'autobook:history-urls';
// SvelteKit's own key in history.state (runtime/client/constants.js). Not
// public API; if it ever changes, recordHistoryEntry stops recording and
// every back arrow falls back to hidden / the library — nothing breaks.
const KIT_HISTORY_INDEX = 'sveltekit:history';

function currentIndex(): number | undefined {
  const index = history.state?.[KIT_HISTORY_INDEX];
  return typeof index === 'number' ? index : undefined;
}

function readUrls(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    // Unreadable storage only means no back arrow, never a broken page.
    return {};
  }
}

export function recordHistoryEntry(url: URL) {
  const index = currentIndex();
  if (index === undefined) return;
  // ponytail: one string per navigation, never pruned; a long day of reading
  // is a few hundred entries — trim to the last N if it ever matters.
  const urls = readUrls();
  urls[index] = `${url.pathname}${url.search}`;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // Best effort: without the record the arrow hides or goes to the library.
  }
}

/** Path + search of the page `history.back()` would land on, if it is ours. */
export function previousPage(): string | undefined {
  const index = currentIndex();
  return index === undefined ? undefined : readUrls()[index - 1];
}

export function goBack() {
  if (previousPage()) history.back();
  else goto(`${pagePath}/manage`);
}
