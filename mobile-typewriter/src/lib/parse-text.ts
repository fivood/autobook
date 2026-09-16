// Split raw text into chapters using the same heuristics as the desktop app,
// but produce a plain data structure (no DOM) since the mobile viewer renders
// directly from arrays of paragraph strings.
//
// ## Inline marks (images / footnotes)
//
// EPUB carries two things a flat string can't: images and footnote markers.
// The loader encodes them as private-use sentinels inside the text it hands
// us, and this file is the only place that decodes them — everything
// downstream (offsets, flatText, saved positions) sees clean prose.
//
// Marks are *stripped* before any length is measured, so they cost zero
// characters. That's deliberate: `startChar` doubles as the renderer's DOM
// key (`data-seg-start`), so a mark must never become a segment of its own —
// a zero-length segment would collide with the next paragraph's key. Images
// therefore ride along on the next segment that has text, matching the
// desktop typewriter, where an image contributes 0 to `textContent.length`
// and never becomes a reveal frontier.
//
// ## Markdown formatting
//
// Markdown adds two more kinds of mark, same rules: a *block* mark at the
// start of a line (heading level, quote, list item, code line, table row,
// rule) and *style* ranges inside it (bold, italic, code, strike, link, table
// column rule). Neither adds a character to the text, so the typewriter types
// exactly the words and the formatting is paint on top.


/** Sentinels the EPUB loader embeds. Private-use area, so they can never
 * collide with real book text. IMG/NOTE open, END closes, SEP splits the
 * note's display number from its id. */
export const MARK_IMG = '';
export const MARK_END = '';
export const MARK_NOTE = '';
export const MARK_SEP = '';
/** Markdown: `MARK_BLOCK kind MARK_END` at line start; `MARK_STYLE kind
 * MARK_END` opens a style range, `MARK_STYLE_END` closes the innermost one. */
export const MARK_BLOCK = '\uE004';
export const MARK_STYLE = '\uE005';
export const MARK_STYLE_END = '\uE006';

const SENTINEL_RE = /[\uE000\uE002\uE004\uE005\uE006]/g;
const ANY_SENTINEL_RE = /[\uE000\uE002\uE004\uE005\uE006]/;

export interface NoteMark {
  /** Offset into the owning segment's `text` where the marker sits. */
  at: number;
  /** Lookup key into `ParsedBook.notes`. */
  id: string;
  /** Display number, as printed in the book (restarts per chapter file). */
  n: string;
}

export type StyleKind = 'b' | 'i' | 's' | 'code' | 'a' | 'sep';

export interface StyleRange {
  kind: StyleKind;
  /** Offsets into the owning segment's `text`, end exclusive. */
  from: number;
  to: number;
  /** Link target, `a` only (already vetted by the loader). */
  href?: string;
}

export interface Marks {
  /** Asset keys into the loader's image map, rendered above the text. */
  images: string[];
  notes: NoteMark[];
  /** Markdown block kind for the whole line: `h1`…`h6`, `quote`,
   * `ul:depth`, `ol:depth:number`, `li:depth` (list continuation),
   * `code[:t|e|te]` (first / last line of the fence), `thead`, `row`, `hr`. */
  block?: string;
  styles?: StyleRange[];
  /** A Markdown rule sat on the (text-less) line before this one. */
  ruleBefore?: boolean;
}

/** Pull the sentinels out of one line, returning clean text plus the marks
 * with offsets into that clean text. A mark missing its terminator is left
 * in the text as-is, as the old pattern match did. */
export function decodeMarks(line: string): { text: string; marks?: Marks } {
  if (!ANY_SENTINEL_RE.test(line)) return { text: line };
  const images: string[] = [];
  const notes: NoteMark[] = [];
  const styles: StyleRange[] = [];
  const open: Omit<StyleRange, 'to'>[] = [];
  let block: string | undefined;
  let out = '';
  let i = 0;
  const closeStyle = (o: Omit<StyleRange, 'to'>) => {
    if (out.length > o.from) styles.push({ ...o, to: out.length });
  };

  while (i < line.length) {
    SENTINEL_RE.lastIndex = i;
    const m = SENTINEL_RE.exec(line);
    if (!m) {
      out += line.slice(i);
      break;
    }
    out += line.slice(i, m.index);
    const at = m.index;
    const mark = line[at];

    if (mark === MARK_STYLE_END) {
      const o = open.pop();
      if (o) closeStyle(o);
      i = at + 1;
      continue;
    }

    const end = line.indexOf(MARK_END, at + 1);
    if (mark === MARK_NOTE) {
      const sep = line.indexOf(MARK_SEP, at + 1);
      const noteEnd = sep < 0 ? -1 : line.indexOf(MARK_END, sep + 1);
      if (noteEnd < 0 || (end >= 0 && end < sep)) {
        out += mark;
        i = at + 1;
        continue;
      }
      notes.push({ at: out.length, id: line.slice(sep + 1, noteEnd), n: line.slice(at + 1, sep) });
      i = noteEnd + 1;
      continue;
    }
    if (end < 0) {
      out += line.slice(at);
      break;
    }
    const value = line.slice(at + 1, end);
    if (mark === MARK_IMG) images.push(value);
    else if (mark === MARK_BLOCK) block = value;
    else if (value.startsWith('a:')) open.push({ kind: 'a', href: value.slice(2), from: out.length });
    else open.push({ kind: value as StyleKind, from: out.length });
    i = end + 1;
  }
  // A style still open at the end of the line (a hard break inside bold, say)
  // stops here; the next line starts plain.
  while (open.length) closeStyle(open.pop()!);

  const any = images.length || notes.length || styles.length || block !== undefined;
  return {
    text: out,
    marks: any
      ? {
          images,
          notes,
          ...(block !== undefined ? { block } : {}),
          ...(styles.length ? { styles: styles.sort((a, b) => a.from - b.from) } : {})
        }
      : undefined
  };
}

/** Trim a decoded line, shifting note and style offsets by the whitespace
 * dropped off the front so they still point at the right character. Code
 * lines keep their indentation — it is the code's structure — and a blank
 * one keeps a single space, since an empty line would vanish as a spacer. */
function trimDecoded(text: string, marks?: Marks): string {
  if (marks?.block?.split(':')[0] === 'code') return text.trimEnd() || ' ';
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (marks) {
    const clamp = (n: number) => Math.max(0, Math.min(trimmed.length, n - lead));
    for (const note of marks.notes) note.at = clamp(note.at);
    if (marks.styles) {
      for (const r of marks.styles) {
        r.from = clamp(r.from);
        r.to = clamp(r.to);
      }
      marks.styles = marks.styles.filter((r) => r.to > r.from);
    }
  }
  return trimmed;
}

const CHAPTER_PATTERNS: RegExp[] = [
  /^第[零〇一二两三四五六七八九十百千万亿0-9０-９]+\s*[章节節回卷部篇编編](\s|$|[：:、，,．.\-—].*)/,
  /^(序章|序言|序幕|楔子|引子|前言|序|后记|後記|尾声|尾聲|番外篇?|外传|外傳|附录|附錄|跋|终章|終章|致谢|致謝|结语|結語|致读者)(\s.*)?$/,
  /^(chapter|section|part|prologue|epilogue)\s+[ivxlcdm\d]+([:：.\s].*)?$/i,
  /^[\d０-９]{1,4}$/,
  /^[零〇一二两三四五六七八九十百千]{1,5}$/
];

export interface Paragraph {
  /** Empty string means a blank-line spacer. */
  text: string;
  marks?: Marks;
}

export interface Chapter {
  /** Title or empty string for the auto-split bucket at the start of an untitled book. */
  title: string;
  /** Paragraphs, in order. */
  paragraphs: Paragraph[];
  /** Marks that belong to the chapter title line (a chapter-opening
   * illustration usually lands here). */
  titleMarks?: Marks;
  /** Character offset into the flat book text where this chapter begins. */
  startChar: number;
  /** Total character count in this chapter (including the title). */
  charCount: number;
}

export interface Segment {
  type: 'h2' | 'p';
  text: string;
  /** Char range in flatText (inclusive, exclusive) so the typewriter reveal
   * can slice into individual segments cleanly. */
  startChar: number;
  endChar: number;
  /** Image asset keys to render above this segment. */
  images?: string[];
  /** Footnote markers positioned inside `text`. */
  notes?: NoteMark[];
  /** Markdown block kind, see `Marks.block`. */
  block?: string;
  /** Markdown inline styles over `text`. */
  styles?: StyleRange[];
  /** Draw a Markdown rule above this segment. */
  ruleBefore?: boolean;
}

export interface ParsedBook {
  chapters: Chapter[];
  /** Flat list of structural segments. Each segment occupies a contiguous
   * range of flatText so the cursor's char position maps onto exactly one. */
  segments: Segment[];
  totalChars: number;
  /** Concatenated text for char-offset based seeking. */
  flatText: string;
}

function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  for (const re of CHAPTER_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  return false;
}

export function parseText(raw: string): ParsedBook {
  const lines = raw.split(/\r?\n/);
  const chapters: Chapter[] = [];
  let current: Chapter = { title: '', paragraphs: [], startChar: 0, charCount: 0 };
  let cursor = 0;

  const commit = () => {
    if (current.paragraphs.length || current.title) chapters.push(current);
  };

  const open = (title: string) => {
    commit();
    current = { title, paragraphs: [], startChar: cursor, charCount: title.length };
    cursor += title.length;
  };

  // Images from text-less lines (full-page plates, chapter dividers) queue up
  // here and attach to the next line that does have text — see the header note
  // on why they must not become segments of their own.
  let pendingImages: string[] = [];
  // Same for a Markdown rule: a line of its own with no text.
  let pendingRule = false;

  for (const raw of lines) {
    const decoded = decodeMarks(raw);
    const block = decoded.marks?.block;
    const trimmed = trimDecoded(decoded.text, decoded.marks);
    if (!trimmed) {
      if (block === 'hr') pendingRule = true;
      else if (decoded.marks?.images.length) pendingImages.push(...decoded.marks.images);
      else current.paragraphs.push({ text: '' });
      continue;
    }
    if (pendingImages.length || pendingRule) {
      decoded.marks ??= { images: [], notes: [] };
      if (pendingImages.length) {
        decoded.marks.images = [...pendingImages, ...decoded.marks.images];
        pendingImages = [];
      }
      if (pendingRule) {
        decoded.marks.ruleBefore = true;
        pendingRule = false;
      }
    }
    // A Markdown `#`/`##` heading is a chapter whatever its words; `###` and
    // below stay inside the chapter as sub-headings. Other Markdown blocks
    // (list items, quotes, code) never open one, even when their text looks
    // like 「一」 or 「1」 — plain lines keep the text-book heuristics.
    const headingLevel = block && /^h[1-6]$/.test(block) ? Number(block[1]) : 0;
    const opensChapter = headingLevel ? headingLevel <= 2 : !block && isChapterHeading(trimmed);
    if (opensChapter) {
      open(trimmed);
      current.titleMarks = decoded.marks;
      continue;
    }
    current.paragraphs.push({ text: trimmed, marks: decoded.marks });
    current.charCount += trimmed.length;
    cursor += trimmed.length;
  }
  commit();

  // Drop any trailing all-empty entries from the last chapter
  for (let i = chapters.length - 1; i >= 0; i--) {
    while (
      chapters[i].paragraphs.length > 0 &&
      chapters[i].paragraphs[chapters[i].paragraphs.length - 1].text === ''
    ) {
      chapters[i].paragraphs.pop();
    }
  }

  // Build a flat text representation that exactly matches what the typewriter
  // will reveal AND a parallel segment list so the renderer can give each
  // chapter title and paragraph the right tag (and the cursor falls into
  // exactly one segment at any reveal index).
  const parts: string[] = [];
  const segments: Segment[] = [];
  let total = 0;
  for (const ch of chapters) {
    ch.startChar = total;
    let chLen = 0;
    if (ch.title) {
      segments.push({
        type: 'h2',
        text: ch.title,
        startChar: total + chLen,
        endChar: total + chLen + ch.title.length,
        ...markFields(ch.titleMarks)
      });
      parts.push(ch.title);
      chLen += ch.title.length;
    }
    for (const p of ch.paragraphs) {
      if (!p.text) continue; // blank-line spacers — segment spacing handles visual gap
      segments.push({
        type: 'p',
        text: p.text,
        startChar: total + chLen,
        endChar: total + chLen + p.text.length,
        ...markFields(p.marks)
      });
      parts.push(p.text);
      chLen += p.text.length;
    }
    ch.charCount = chLen;
    total += chLen;
  }

  // Images trailing the very last line of text (a back-cover plate) have
  // nothing after them to ride on, so they go onto the final segment rather
  // than being dropped.
  if (pendingImages.length && segments.length) {
    const last = segments[segments.length - 1];
    last.images = [...(last.images ?? []), ...pendingImages];
  }

  return {
    chapters,
    segments,
    totalChars: total,
    flatText: parts.join('\n')
  };
}

function markFields(
  marks?: Marks
): Pick<Segment, 'images' | 'notes' | 'block' | 'styles' | 'ruleBefore'> {
  if (!marks) return {};
  return {
    ...(marks.images.length ? { images: marks.images } : {}),
    ...(marks.notes.length ? { notes: marks.notes } : {}),
    ...(marks.block ? { block: marks.block } : {}),
    ...(marks.styles?.length ? { styles: marks.styles } : {}),
    ...(marks.ruleBefore ? { ruleBefore: true } : {})
  };
}
