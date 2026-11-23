/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Auto-tagging: turn what we know about a book into a handful of topic tags.
 *
 * Two layers, and the first one has to stand on its own:
 *
 *   1. Baseline — normalise `bookMetadata.subjects` (the OPF `dc:subject`
 *      block). No model, no network, runs on every book instantly. Most
 *      EPUBs carry *something* there; it is just in a shape nobody wants to
 *      look at (BISAC codes, slash-separated heading paths, case variants).
 *   2. Model — fills in the books whose file said nothing, and proposes
 *      tags the subject block couldn't. Strictly additive: when no model is
 *      configured the feature still does layer 1 and nothing degrades.
 *
 * Neither layer writes anywhere by itself. Tags land in `manualBook.tags`,
 * which is the user-entered store, and putting derived guesses there without
 * asking would repeat exactly the mistake the v12 store split exists to
 * prevent. The job produces suggestions; the reader applies them.
 *
 * The single biggest quality lever is not the prompt — it is feeding the
 * library's existing tags back in as vocabulary. Tags are only worth having
 * if they cluster, and a model left to itself will happily emit 科幻 for one
 * book and 科学幻想 for the next.
 */

/** Cap per book. Beyond this the tag line stops being scannable. */
export const MAX_TAGS_PER_BOOK = 8;
/** Tighter cap for model output — it will pad to the limit if allowed to. */
export const MAX_MODEL_TAGS_PER_BOOK = 5;

const MAX_TAG_CHARS = 24;

/**
 * Segment separators inside one `dc:subject` string.
 *
 * `/` is the BISAC heading path ("FICTION / Science Fiction / Space Opera").
 * The comma is the arguable one: splitting it turns the MARC form
 * "Science fiction, American" into a useless "American", but leaving it
 * whole turns the far more common "科幻, 太空歌剧, 长篇" into one run-on
 * tag. Splitting loses less, and it matches how the manual entry dialog
 * already parses the tag field the user types.
 */
const SEGMENT_SPLIT_RE = /[/;；|>、,，]+/;

const BISAC_CODE_RE = /^([A-Z]{3})\d{6}$/;

/**
 * Only the 3-letter prefix, deliberately. The full 6-digit code space is
 * thousands of headings and mapping it would be a data file, not a table;
 * the prefix is the part that still means something as a display tag. A code
 * we can't map is dropped rather than shown — "FIC028010" is not a tag.
 */
const BISAC_PREFIX: Record<string, string> = {
  ANT: 'Antiques',
  ARC: 'Architecture',
  ART: 'Art',
  BIB: 'Bibles',
  BIO: 'Biography',
  BUS: 'Business',
  CGN: 'Comics',
  CKB: 'Cooking',
  COM: 'Computers',
  CRA: 'Crafts',
  DES: 'Design',
  DRA: 'Drama',
  EDU: 'Education',
  FAM: 'Family',
  FIC: 'Fiction',
  FOR: 'Foreign Language',
  GAM: 'Games',
  GAR: 'Gardening',
  HEA: 'Health',
  HIS: 'History',
  HOM: 'House & Home',
  HUM: 'Humor',
  JUV: 'Juvenile',
  LAN: 'Language Arts',
  LAW: 'Law',
  LCO: 'Literary Collections',
  LIT: 'Literary Criticism',
  MAT: 'Mathematics',
  MED: 'Medical',
  MUS: 'Music',
  NAT: 'Nature',
  PER: 'Performing Arts',
  PET: 'Pets',
  PHI: 'Philosophy',
  PHO: 'Photography',
  POE: 'Poetry',
  POL: 'Political Science',
  PSY: 'Psychology',
  REF: 'Reference',
  REL: 'Religion',
  SCI: 'Science',
  SEL: 'Self-Help',
  SOC: 'Social Science',
  SPO: 'Sports',
  STU: 'Study Aids',
  TEC: 'Technology',
  TRA: 'Transportation',
  TRU: 'True Crime',
  TRV: 'Travel',
  YAF: 'Young Adult Fiction',
  YAN: 'Young Adult Nonfiction'
};

/**
 * Tags that survive normalisation but carry no information in a library
 * where everything is a book. Held back rather than deleted: when a subject
 * block contains nothing else, "General" beats showing no tag at all.
 *
 * `fiction` / `nonfiction` are deliberately NOT here — that distinction is
 * one of the few things a one-word tag genuinely tells you.
 */
const GENERIC_TAG_KEYS = new Set([
  'general',
  'generalfiction',
  'misc',
  'miscellaneous',
  'other',
  'others',
  'books',
  'book',
  'ebook',
  'ebooks',
  'text',
  'texts',
  '综合',
  '其他',
  '其它',
  '图书',
  '书籍',
  '电子书',
  '未分类'
]);

/**
 * Normalise one segment into a displayable tag, or '' to drop it.
 *
 * NFKC first: full-width Latin and CJK compatibility forms are common in
 * subject blocks from Japanese and Chinese publishers, and without folding
 * them "ＳＦ" and "SF" dedupe as two different tags.
 */
function cleanTag(raw: string): string {
  const value = raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
    .trim();
  if (!value) return '';
  if ([...value].length > MAX_TAG_CHARS) return '';
  // No letter or digit anywhere — a stray bullet or dash.
  if (!/[\p{L}\p{N}]/u.test(value)) return '';
  if (/^\p{N}+$/u.test(value)) return '';
  if (/^[A-Za-z]$/.test(value)) return '';
  return softenAllCaps(value);
}

/**
 * BISAC writes its top-level heading in caps ("FICTION / Science Fiction"),
 * so the path form yields FICTION while the code form yields Fiction from
 * the table above — the same tag in two spellings, on different books.
 * `tagKey` folds them for dedupe, but dedupe is per book; the library would
 * still end up displaying both. Since clustering is the entire point of
 * tagging, the display form gets normalised here.
 *
 * Word-by-word, and only for runs of 4+ letters: acronyms are how these tags
 * are actually written (SF, AI, USA), and title-casing them to Sf / Usa
 * would be worse than the inconsistency being fixed.
 */
function softenAllCaps(value: string): string {
  return value
    .split(' ')
    .map((word) =>
      /^[A-Z]{4,}$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word
    )
    .join(' ');
}

/**
 * Dedupe key. Folds case, width, spacing and punctuation so "Science
 * Fiction", "science-fiction" and "SCIENCE FICTION" collapse to one tag
 * while the first spelling seen is what gets displayed.
 */
export function tagKey(tag: string): string {
  return tag
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * Layer 1. Pure, synchronous, and the only thing that runs when no model is
 * configured.
 */
export function normalizeSubjectTags(
  subjects: readonly string[] | undefined,
  maxTags = MAX_TAGS_PER_BOOK
): string[] {
  if (!subjects?.length) return [];

  const kept: string[] = [];
  const seen = new Set<string>();
  const generic: string[] = [];
  const genericSeen = new Set<string>();

  for (const raw of subjects) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const code = BISAC_CODE_RE.exec(trimmed.toUpperCase());
    const segments = code ? [BISAC_PREFIX[code[1] ?? ''] ?? ''] : trimmed.split(SEGMENT_SPLIT_RE);

    for (const segment of segments) {
      const tag = cleanTag(segment);
      if (!tag) continue;
      const key = tagKey(tag);
      if (!key) continue;

      if (GENERIC_TAG_KEYS.has(key)) {
        if (!genericSeen.has(key)) {
          genericSeen.add(key);
          generic.push(tag);
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(tag);
    }
  }

  return (kept.length ? kept : generic).slice(0, maxTags);
}

/**
 * The library's own tag vocabulary, most-used first, fed to the model so it
 * reuses existing wording instead of coining a synonym per book.
 *
 * Frequency order matters more than it looks: the list gets truncated for
 * the prompt, and what survives truncation should be the terms the library
 * has actually settled on.
 */
export function collectTagVocabulary(
  tagLists: readonly (readonly string[] | undefined)[],
  limit = 40
): string[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const list of tagLists) {
    if (!list?.length) continue;
    // Per-book dedupe first, so one book listing a tag twice can't inflate it.
    const localSeen = new Set<string>();
    for (const raw of list) {
      const tag = cleanTag(String(raw ?? ''));
      if (!tag) continue;
      const key = tagKey(tag);
      if (!key || localSeen.has(key)) continue;
      localSeen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map((entry) => entry.tag);
}

/** One book as handed to the model. */
export interface TaggableBook {
  /** Echoed back as `id`. Index into the caller's list — stable, short. */
  index: number;
  title: string;
  author?: string;
  publisher?: string;
  language?: string;
  /** Layer-1 output. Grounding for the model, not a target to reproduce. */
  subjectTags: string[];
}

/**
 * Group books into requests. Unlike OCR batching there is no page boundary to
 * respect — books are independent and tiny — so this is a plain size cap.
 * Small batches on purpose: a 1.5B model's tag quality falls off noticeably
 * once it is tracking a dozen titles at once.
 */
export function batchTaggableBooks(
  books: readonly TaggableBook[],
  maxBooks = 8,
  maxChars = 1200
): TaggableBook[][] {
  const batches: TaggableBook[][] = [];
  let current: TaggableBook[] = [];
  let chars = 0;

  for (const book of books) {
    const size = book.title.length + (book.author?.length ?? 0) + book.subjectTags.join('').length;
    if (current.length && (current.length >= maxBooks || chars + size > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(book);
    chars += size;
  }
  if (current.length) batches.push(current);

  return batches;
}

export function buildTagSystemPrompt(
  vocabulary: readonly string[],
  tagLanguage = '中文'
): string {
  const lines = [
    '你在给一个私人书库的书打主题标签。输入是书名、作者、出版社，以及从书籍',
    '文件元数据里读出来的主题词（可能为空）。',
    '规则：',
    `1. 每本给 2-5 个标签：题材、体裁、主题。全部用${tagLanguage}。`,
    '2. 标签要短——不带标点，不要书名，不要作者名，不要「小说」「图书」这类',
    '   放在哪本书上都成立的词。',
    '3. **认不出这本书就少给或给空数组**。标签是拿来分组的，猜错的标签比没有',
    '   标签更糟——它会把两本不相干的书归到一起。不确定就返回 "tags": []。',
    '4. 已有主题词能用就直接沿用，别改写成同义词。',
    '5. id 原样回传，不要合并或拆分条目。'
  ];

  if (vocabulary.length) {
    lines.push(
      '',
      '这个书库已经在用的标签，能套上就优先套用原词（标签的价值在于聚类，',
      '同一个意思各写各的等于没打）：',
      vocabulary.join('、')
    );
  }

  lines.push('', '仅输出 JSON：{"books":[{"id":<数字>,"tags":["标签1","标签2"]}]}');
  return lines.join('\n');
}

export function buildTagUserPrompt(batch: readonly TaggableBook[]): string {
  return JSON.stringify(
    batch.map((book) => ({
      id: book.index,
      title: book.title,
      ...(book.author ? { author: book.author } : {}),
      ...(book.publisher ? { publisher: book.publisher } : {}),
      ...(book.language ? { language: book.language } : {}),
      ...(book.subjectTags.length ? { subjects: book.subjectTags } : {})
    }))
  );
}

/**
 * Reject the shapes a model reaches for when it doesn't know the book: the
 * title back as a tag, the author's name, a sentence, a "I'm not sure"
 * apology. Each of these is worse than no tag, because a wrong tag silently
 * groups unrelated books.
 */
export function isPlausibleTag(tag: string, book: TaggableBook): boolean {
  if (!tag) return false;
  const key = tagKey(tag);
  if (!key) return false;
  if (GENERIC_TAG_KEYS.has(key)) return false;
  // Sentence punctuation, or enough words to be prose rather than a label.
  if (/[。！？!?]/.test(tag)) return false;
  if (tag.split(' ').length > 4) return false;
  // The word-count rule above is blind to CJK, which has no spaces, and the
  // punctuation rule is blind to a sentence whose final 。 cleanTag already
  // stripped off the end. So "我不确定这本书是什么。" arrives here looking
  // like a perfectly short tag. Script-aware length is what actually
  // separates a label from prose: real CJK tags run 2-6 characters
  // (科幻 / 太空歌剧 / 日本近代文学史), refusals and summaries run longer.
  if ((tag.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length > 8) {
    return false;
  }

  const titleKey = tagKey(book.title);
  if (titleKey && (key === titleKey || key.includes(titleKey))) return false;
  const authorKey = book.author ? tagKey(book.author) : '';
  if (authorKey && key === authorKey) return false;

  return true;
}

/**
 * Parse one batch response. Same discipline as the OCR corrector: anything
 * the model invents — unknown ids, non-arrays, junk strings — is discarded
 * instead of surfaced. A book missing from the response simply keeps its
 * baseline tags.
 */
/**
 * The row list, whatever wrapper the model put around it.
 *
 * The prompt asks for `{"books":[…]}` and usually gets it. Observed against a
 * real 14B model, it also sometimes drops the wrapper and answers with a bare
 * `{"id":0,"tags":[…]}` — one row, no envelope. Requiring the envelope threw
 * the whole batch away and had the job count it as a failure, when a usable
 * answer for one of the books was sitting right there. Discarding what the
 * model invents is right; discarding what it got right for lack of a wrapper
 * is not.
 */
function rowsFrom(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return undefined;
  const books = (parsed as { books?: unknown }).books;
  if (Array.isArray(books)) return books;
  // A single unwrapped row: only when it actually looks like one, so a
  // response of some other shape still falls through to the next candidate.
  const row = parsed as { id?: unknown; tags?: unknown };
  if (row.id !== undefined && Array.isArray(row.tags)) return [row];
  return undefined;
}

export function parseTagResponse(
  raw: string,
  batch: readonly TaggableBook[]
): Map<number, string[]> {
  const byIndex = new Map(batch.map((book) => [book.index, book]));
  const out = new Map<number, string[]>();

  const text = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!text) return out;

  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const rows = rowsFrom(parsed);
    if (!rows) continue;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const value = row as { id?: unknown; tags?: unknown };
      const id = typeof value.id === 'number' ? value.id : Number(value.id);
      if (!Number.isFinite(id)) continue;
      const book = byIndex.get(id);
      if (!book || !Array.isArray(value.tags)) continue;

      const tags: string[] = [];
      const seen = new Set<string>();
      for (const entry of value.tags) {
        if (typeof entry !== 'string') continue;
        const tag = cleanTag(entry);
        if (!tag || !isPlausibleTag(tag, book)) continue;
        const key = tagKey(tag);
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
        if (tags.length >= MAX_MODEL_TAGS_PER_BOOK) break;
      }
      // An empty array is a real answer here ("I don't know this book"), so
      // it is recorded rather than skipped — that is what rule 3 asked for.
      out.set(id, tags);
    }
    if (out.size) return out;
  }

  return out;
}

/**
 * Union of what's already stored and what's being applied, existing tags
 * first. Case/width variants collapse to whatever was already there, so
 * applying a suggestion can never fork an existing tag into two spellings.
 */
export function mergeTags(
  existing: readonly string[] | undefined,
  incoming: readonly string[],
  maxTags = MAX_TAGS_PER_BOOK
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const list of [existing ?? [], incoming]) {
    for (const raw of list) {
      const tag = cleanTag(String(raw ?? ''));
      if (!tag) continue;
      const key = tagKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
      if (out.length >= maxTags) return out;
    }
  }

  return out;
}

/**
 * How many more tags a book can take before `mergeTags` starts dropping them.
 *
 * Counted against the *deduped* existing list, because that is what mergeTags
 * keeps: a book storing both 「Science Fiction」 and 「science-fiction」 has one
 * tag as far as the cap is concerned, and reading `existing.length` would
 * understate the room by one.
 */
export function remainingTagCapacity(
  existing: readonly string[] | undefined,
  maxTags = MAX_TAGS_PER_BOOK
): number {
  return Math.max(0, maxTags - mergeTags(existing, [], maxTags).length);
}

/** Tags in `incoming` that `existing` doesn't already cover. */
export function newTagsOnly(
  existing: readonly string[] | undefined,
  incoming: readonly string[]
): string[] {
  const have = new Set((existing ?? []).map((tag) => tagKey(cleanTag(String(tag ?? '')))));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const tag = cleanTag(String(raw ?? ''));
    if (!tag) continue;
    const key = tagKey(tag);
    if (!key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
