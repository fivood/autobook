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


/** Sentinels the EPUB loader embeds. Private-use area, so they can never
 * collide with real book text. IMG/NOTE open, END closes, SEP splits the
 * note's display number from its id. */
export const MARK_IMG = '';
export const MARK_END = '';
export const MARK_NOTE = '';
export const MARK_SEP = '';

const MARK_RE = /([^]*)|([^]*)([^]*)/g;

export interface NoteMark {
  /** Offset into the owning segment's `text` where the marker sits. */
  at: number;
  /** Lookup key into `ParsedBook.notes`. */
  id: string;
  /** Display number, as printed in the book (restarts per chapter file). */
  n: string;
}

export interface Marks {
  /** Asset keys into the loader's image map, rendered above the text. */
  images: string[];
  notes: NoteMark[];
}

/** Pull the sentinels out of one line, returning clean text plus the marks
 * with offsets into that clean text. */
export function decodeMarks(line: string): { text: string; marks?: Marks } {
  if (!line.includes(MARK_IMG) && !line.includes(MARK_NOTE)) return { text: line };
  const images: string[] = [];
  const notes: NoteMark[] = [];
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  MARK_RE.lastIndex = 0;
  while ((m = MARK_RE.exec(line))) {
    out += line.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] !== undefined) images.push(m[1]);
    else notes.push({ at: out.length, id: m[3], n: m[2] });
  }
  out += line.slice(last);
  return {
    text: out,
    marks: images.length || notes.length ? { images, notes } : undefined
  };
}

/** Trim a decoded line, shifting note offsets by the whitespace dropped off
 * the front so they still point at the right character. */
function trimDecoded(text: string, marks?: Marks): string {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (marks) {
    for (const note of marks.notes) {
      note.at = Math.max(0, Math.min(trimmed.length, note.at - lead));
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

  for (const raw of lines) {
    const decoded = decodeMarks(raw);
    const trimmed = trimDecoded(decoded.text, decoded.marks);
    if (!trimmed) {
      if (decoded.marks?.images.length) pendingImages.push(...decoded.marks.images);
      else current.paragraphs.push({ text: '' });
      continue;
    }
    if (pendingImages.length) {
      const carried = pendingImages;
      pendingImages = [];
      if (decoded.marks) decoded.marks.images = [...carried, ...decoded.marks.images];
      else decoded.marks = { images: carried, notes: [] };
    }
    if (isChapterHeading(trimmed)) {
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

function markFields(marks?: Marks): { images?: string[]; notes?: NoteMark[] } {
  if (!marks) return {};
  return {
    ...(marks.images.length ? { images: marks.images } : {}),
    ...(marks.notes.length ? { notes: marks.notes } : {})
  };
}
