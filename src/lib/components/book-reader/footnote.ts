import { Subject } from 'rxjs';

/**
 * In-book note links open a popup instead of jumping. Jumping was the old
 * behaviour, and in books that gather every note in one file (Duokan/Calibre
 * conversions put a whole book's notes at the end of some later chapter) it
 * threw the reader dozens of chapters ahead — past spoilers — with only the
 * browser's back gesture, which this reader doesn't have, to return.
 */
export const footnote$ = new Subject<{ anchor: Element; text: string }>();

// A note link's visible text: 1, [12], (3), ［注2］, ★, [☆], *, ※, †…
const MARKER_TEXT =
  /^[[(（【〔［]?\s*(?:\d{1,3}|[a-z]|[ivx]{1,5}|[*＊★☆※†‡§¶◎○●]{1,3}|注\s*\d{0,3})\s*[\])）】〕］]?$/i;

export function looksLikeNoteMarker(text: string): boolean {
  return MARKER_TEXT.test(text.trim());
}

// `epub\:type` matches the literal `epub:type` attribute DOMParser keeps in
// text/html mode — same escape the TOC lookup in generate-epub-html uses.
const NOTE_BODY = [
  'aside',
  ...['footnote', 'footnotes', 'endnote', 'endnotes', 'rearnote', 'rearnotes', 'note'].map(
    (t) => `[epub\\:type~="${t}"]`
  ),
  '[role="doc-footnote"]',
  '[role="doc-endnote"]',
  '[role="doc-endnotes"]',
  'li[class*="note"]',
  'ol[class*="note"]',
  'div[class*="footnote"]',
  'div[class*="endnote"]',
  'p[class*="footnote"]',
  'p[class*="endnote"]'
].join(',');

const INLINE = /^(a|span|sup|sub|small|em|i|b|strong|code)$/i;
const HEADING = 'h1,h2,h3,h4,h5,h6';
// Longer than this and the "note" is really a section someone linked to.
const MAX_NOTE_CHARS = 2000;

function isNoteRef(a: Element) {
  const type = a.getAttribute('epub:type') || '';
  const text = (a.textContent || '').trim();
  return (
    /noteref/i.test(type) ||
    a.getAttribute('role') === 'doc-noteref' ||
    /noteref|footnote|endnote/i.test(a.getAttribute('class') || '') ||
    // Only a short <sup> link is a reference. MOBI6 (no classes left) sets the
    // notes list's back-links — the whole note text — in <sup> too, and those
    // must jump back, not pop up the paragraph that cites them.
    (text.length <= 8 && (!!a.closest('sup') || !!a.querySelector('sup'))) ||
    looksLikeNoteMarker(text)
  );
}

/**
 * The note text `a` points at, or null when it's an ordinary cross-link that
 * should keep jumping. `target` is the element its href resolves to.
 */
export function noteTextFor(a: Element, target: Element): string | null {
  // Back-links inside a note body lead to the reference; as refs they would
  // pop up the "[1]" they point at.
  if (a.parentElement?.closest(NOTE_BODY)) return null;

  // A bare `<a id>` dropped in front of the note text: the note is its block.
  const block = INLINE.test(target.tagName)
    ? target.closest('p,li,dd,aside,div') || target
    : target;
  if (block.matches(`${HEADING},[id^="ttu-"],[class*="ttu-book"]`)) return null;
  if (block.querySelector(HEADING)) return null;
  if (!block.closest(NOTE_BODY) && !isNoteRef(a)) return null;

  // Back-arrows (↩) at the end of a note are links, not text.
  const text = (block.textContent || '')
    .replace(/[↩↑⤴]︎?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > MAX_NOTE_CHARS) return null;
  return text;
}
