// Split raw text into chapters using the same heuristics as the desktop app,
// but produce a plain data structure (no DOM) since the mobile viewer renders
// directly from arrays of paragraph strings.

const CHAPTER_PATTERNS: RegExp[] = [
  /^第[零〇一二两三四五六七八九十百千万亿0-9０-９]+\s*[章节節回卷部篇编編](\s|$|[：:、，,．.\-—].*)/,
  /^(序章|序言|序幕|楔子|引子|前言|序|后记|後記|尾声|尾聲|番外篇?|外传|外傳|附录|附錄|跋|终章|終章|致谢|致謝|结语|結語|致读者)(\s.*)?$/,
  /^(chapter|section|part|prologue|epilogue)\s+[ivxlcdm\d]+([:：.\s].*)?$/i,
  /^[\d０-９]{1,4}$/,
  /^[零〇一二两三四五六七八九十百千]{1,5}$/
];

export interface Chapter {
  /** Title or empty string for the auto-split bucket at the start of an untitled book. */
  title: string;
  /** Paragraph strings, in order. Empty entries mean blank-line spacers. */
  paragraphs: string[];
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

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      current.paragraphs.push('');
      continue;
    }
    if (isChapterHeading(trimmed)) {
      open(trimmed);
      continue;
    }
    current.paragraphs.push(trimmed);
    current.charCount += trimmed.length;
    cursor += trimmed.length;
  }
  commit();

  // Drop any trailing all-empty entries from the last chapter
  for (let i = chapters.length - 1; i >= 0; i--) {
    while (
      chapters[i].paragraphs.length > 0 &&
      chapters[i].paragraphs[chapters[i].paragraphs.length - 1] === ''
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
        endChar: total + chLen + ch.title.length
      });
      parts.push(ch.title);
      chLen += ch.title.length;
    }
    for (const p of ch.paragraphs) {
      if (!p) continue; // blank-line spacers — segment spacing handles visual gap
      segments.push({
        type: 'p',
        text: p,
        startChar: total + chLen,
        endChar: total + chLen + p.length
      });
      parts.push(p);
      chLen += p.length;
    }
    ch.charCount = chLen;
    total += chLen;
  }

  return {
    chapters,
    segments,
    totalChars: total,
    flatText: parts.join('\n')
  };
}
