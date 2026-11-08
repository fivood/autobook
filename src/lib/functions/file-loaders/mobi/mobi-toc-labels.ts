/**
 * Section titles for MOBI6 books, read off the book's own contents page.
 *
 * MOBI6 chapter titles are usually `<p><b>…</b></p>`, not `<h1>`, so the
 * heading scan finds nothing and every TOC entry reads `section-N`. The book
 * does carry a contents page, though: one `<a href="#fileposN">第一章</a>` per
 * chapter (the Rust side has already turned `filepos=` links into these),
 * each pointing at the very start of a section.
 *
 * Other sections link to section starts too — a notes list links back to
 * references, and a reference can sit near a chapter's top — so only the
 * contents page counts: the section with the most links to section starts.
 */

// Text allowed before an anchor that still "opens" its section: a stray
// part number or ornament, not a paragraph.
const MAX_LEAD_CHARS = 20;
const MAX_LABEL_CHARS = 80;
// Fewer links than this to section starts isn't a contents page.
const MIN_TOC_ENTRIES = 3;

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '');

/** Section index → title, for sections whose start a contents link points at. */
export function tocLabels(parts: string[]): Map<number, string> {
  const opens = new Map<string, number>();
  parts.forEach((body, i) => {
    for (const m of body.matchAll(/\bid="(filepos\d+)"/g)) {
      const lead = stripTags(body.slice(0, m.index)).trim();
      if (Array.from(lead).length <= MAX_LEAD_CHARS) opens.set(m[1], i);
    }
  });

  const entries = parts.map((body, from) => {
    const found: [number, string][] = [];
    for (const m of body.matchAll(/<a\b[^>]*href="#(filepos\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const target = opens.get(m[1]);
      if (target === undefined || target === from) continue;
      found.push([target, stripTags(m[2]).replace(/\s+/g, ' ').trim()]);
    }
    return found;
  });
  const toc = entries.reduce((best, e) => (e.length > best.length ? e : best), [] as [number, string][]);

  const labels = new Map<number, string>();
  if (toc.length < MIN_TOC_ENTRIES) return labels;
  for (const [target, text] of toc) {
    if (text && Array.from(text).length <= MAX_LABEL_CHARS && !labels.has(target)) {
      labels.set(target, text);
    }
  }
  return labels;
}
