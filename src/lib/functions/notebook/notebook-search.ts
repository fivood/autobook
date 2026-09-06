import type {
  BooksDbHighlight,
  HighlightSlot
} from '$lib/data/database/books-db/versions/books-db';
import { LEGACY_SLOT_OF_COLOR } from '$lib/data/highlight-color';

export const STANDALONE_GROUP_TITLE = '__standalone__';

export type NotebookSortKey = 'auto' | 'modified' | 'created' | 'relevance';
export type TagMode = 'and' | 'or';

export interface NotebookGroup {
  title: string;
  items: BooksDbHighlight[];
}

export interface NotebookFilterResult {
  filtered: BooksDbHighlight[];
  groups: NotebookGroup[];
}

export interface ParsedQuery {
  freeTerms: string[];
  memoTerms: string[];
  tagTerms: string[];
  bookTerms: string[];
  colors: HighlightSlot[];
  kinds: Set<'note' | 'highlight'>;
  hasTextFilters: boolean;
}

/** `slot:2` is the current spelling; the colour names stay as aliases so
 *  queries people already typed (and saved searches) keep working. */
const SLOT_ALIASES: Record<string, HighlightSlot> = {
  ...LEGACY_SLOT_OF_COLOR,
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4'
};

/** Parse `memo:foo tag:bar book:baz slot:2 kind:note` + bare terms.
 * Bare terms match across text + memo + bookTitle + tags (legacy behavior). */
export function parseNotebookQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = {
    freeTerms: [],
    memoTerms: [],
    tagTerms: [],
    bookTerms: [],
    colors: [],
    kinds: new Set(),
    hasTextFilters: false
  };
  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    const colon = tok.indexOf(':');
    if (colon > 0) {
      const field = tok.slice(0, colon).toLowerCase();
      const val = tok.slice(colon + 1).toLowerCase();
      if (!val) continue;
      let matched = true;
      if (field === 'memo') result.memoTerms.push(val);
      else if (field === 'tag') result.tagTerms.push(val);
      else if (field === 'book') result.bookTerms.push(val);
      else if ((field === 'slot' || field === 'color') && SLOT_ALIASES[val])
        result.colors.push(SLOT_ALIASES[val]);
      else if (field === 'kind' && (val === 'note' || val === 'highlight')) result.kinds.add(val);
      else matched = false;
      if (matched) result.hasTextFilters = true;
      else result.freeTerms.push(tok.toLowerCase());
    } else {
      result.freeTerms.push(tok.toLowerCase());
    }
  }
  if (result.freeTerms.length) result.hasTextFilters = true;
  return result;
}

/** Terms to <mark> in rendered text/memo/bookTitle. */
export function collectMatchTerms(q: ParsedQuery): string[] {
  const out = new Set<string>([...q.freeTerms, ...q.memoTerms, ...q.bookTerms, ...q.tagTerms]);
  return [...out].filter(Boolean);
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return count;
}

function relevanceScore(h: BooksDbHighlight, q: ParsedQuery): number {
  const memoLow = h.memo.toLowerCase();
  const textLow = h.text.toLowerCase();
  const bookLow = h.bookTitle.toLowerCase();
  const tagLow = (h.tags || []).join(' ').toLowerCase();
  let score = 0;
  for (const t of q.freeTerms) {
    score += countOccurrences(memoLow, t) * 2 + countOccurrences(textLow, t) + countOccurrences(bookLow, t) * 3 + countOccurrences(tagLow, t) * 2;
  }
  for (const t of q.memoTerms) score += countOccurrences(memoLow, t) * 3;
  for (const t of q.bookTerms) score += countOccurrences(bookLow, t) * 4;
  for (const t of q.tagTerms) score += countOccurrences(tagLow, t) * 3;
  return score;
}

function matchesFilters(
  h: BooksDbHighlight,
  q: ParsedQuery,
  tagSet: Set<string>,
  tagMode: TagMode
): boolean {
  if (tagSet.size) {
    const hTags = h.tags || [];
    if (tagMode === 'and') {
      for (const t of tagSet) if (!hTags.includes(t)) return false;
    } else {
      let any = false;
      for (const t of tagSet) {
        if (hTags.includes(t)) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
  }
  if (q.colors.length && !q.colors.includes(h.color)) return false;
  if (q.kinds.size) {
    const kind = h.kind === 'note' ? 'note' : 'highlight';
    if (!q.kinds.has(kind)) return false;
  }
  for (const t of q.memoTerms) if (!h.memo.toLowerCase().includes(t)) return false;
  for (const t of q.bookTerms) if (!h.bookTitle.toLowerCase().includes(t)) return false;
  for (const t of q.tagTerms) {
    if (!(h.tags || []).some((tag) => tag.toLowerCase().includes(t))) return false;
  }
  for (const t of q.freeTerms) {
    const hay = `${h.text} ${h.memo} ${h.bookTitle} ${(h.tags || []).join(' ')}`.toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}

function sortItems(items: BooksDbHighlight[], q: ParsedQuery, sortKey: NotebookSortKey): BooksDbHighlight[] {
  if (sortKey === 'relevance') {
    return items
      .map((h) => ({ h, s: relevanceScore(h, q) }))
      .sort((a, b) => b.s - a.s || b.h.lastModified - a.h.lastModified)
      .map((x) => x.h);
  }
  if (sortKey === 'modified') return [...items].sort((a, b) => b.lastModified - a.lastModified);
  if (sortKey === 'created') return [...items].sort((a, b) => b.createdAt - a.createdAt);
  return items; // 'auto' — caller decides per-group ordering
}

function groupAndSort(
  list: BooksDbHighlight[],
  q: ParsedQuery,
  sortKey: NotebookSortKey
): NotebookGroup[] {
  const map = new Map<string, BooksDbHighlight[]>();
  for (const h of list) {
    const key = h.kind === 'note' ? STANDALONE_GROUP_TITLE : h.bookTitle;
    const arr = map.get(key) || [];
    arr.push(h);
    map.set(key, arr);
  }
  const out: NotebookGroup[] = [...map.entries()].map(([title, items]) => ({
    title,
    items:
      sortKey === 'auto'
        ? title === STANDALONE_GROUP_TITLE
          ? items.sort((a, b) => b.lastModified - a.lastModified)
          : items.sort((a, b) => a.startOffset - b.startOffset)
        : sortItems(items, q, sortKey)
  }));
  out.sort((a, b) => {
    if (a.title === STANDALONE_GROUP_TITLE) return -1;
    if (b.title === STANDALONE_GROUP_TITLE) return 1;
    return a.title.localeCompare(b.title);
  });
  return out;
}

export function filterAndGroup(
  viewFiltered: BooksDbHighlight[],
  q: ParsedQuery,
  tagSet: Set<string>,
  tagMode: TagMode,
  sortKey: NotebookSortKey
): NotebookFilterResult {
  const filtered = viewFiltered.filter((h) => matchesFilters(h, q, tagSet, tagMode));
  const groups = groupAndSort(filtered, q, sortKey);
  return { filtered, groups };
}

export function collectTags(list: BooksDbHighlight[]): string[] {
  const counts = new Map<string, number>();
  for (const h of list) {
    for (const t of h.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape-safe: splits raw text on matches, escapes each segment, wraps matches in <mark>. */
export function highlightHtml(text: string, terms: string[]): string {
  const valid = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!valid.length) return escapeHtml(text);
  const re = new RegExp(`(${valid.join('|')})`, 'gi');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    out += `<mark class="nb-mark">${escapeHtml(m[0])}</mark>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
