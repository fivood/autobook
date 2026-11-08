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
 * Ids that sit at `a`'s spot: its own, its inline wrappers' (`<sup id>`), and
 * empty `<a id>`s just before any of them — where a MOBI6 back-link lands, the
 * Rust side drops `<a id="fileposN"></a>` in front of the reference.
 */
function idsAt(a: Element): string[] {
  const ids: string[] = [];
  for (let el: Element | null = a; el && INLINE.test(el.tagName); el = el.parentElement) {
    if (el.id) ids.push(el.id);
    let prev = el.previousElementSibling;
    while (prev?.tagName === 'A' && !prev.textContent?.trim()) {
      if (prev.id) ids.push(prev.id);
      prev = prev.previousElementSibling;
    }
  }
  return ids;
}

// The reader rewrites rendered links to `/b#id` (see reactive-elements), so
// compare the fragment only.
const hashOf = (l: Element) => (l.getAttribute('href') || '').replace(/^[^#]*/, '');

/** No visible text in `root` before `el` (whitespace and tags don't count). */
function leads(el: Element, root: Element): boolean {
  if (el === root) return true;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (el.contains(n) || el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) return true;
    if (n.textContent?.trim()) return false;
  }
  return true;
}

/**
 * The note links back to this reference: the one sure sign of a note pair
 * that needs no class or marker. MOBI6 books have neither — their markers can
 * be anything — but Kindle notes always carry the back-link.
 *
 * Other links pair up too, so the shape has to fit as well: a note opens at
 * its anchor (a back-link's target sits mid-paragraph, after the text that
 * cites it), and it isn't the first text of its chapter (a contents entry's
 * target is the chapter title, which often links back to the contents).
 */
function linksBack(a: Element, target: Element, block: Element): boolean {
  const text = (a.textContent || '').trim();
  if (!text || text.length > 8 || (block.textContent || '').trim() === text) return false;
  if (!leads(target, block)) return false;
  const section =
    block.parentElement?.closest('[id^="ttu-"], .mobi-section') ?? block.ownerDocument.body;
  if (section && leads(block, section)) return false;
  const back = new Set(idsAt(a).map((id) => `#${id}`));
  if (!back.size) return false;
  return Array.from(block.querySelectorAll('a[href]')).some((l) => back.has(hashOf(l)));
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
  if (!block.closest(NOTE_BODY) && !isNoteRef(a) && !linksBack(a, target, block)) return null;

  // The note's own way back — `返回`, `[1]`, ↩ — is a link, not note text.
  // Except when it's all there is: Calibre's MOBI6 output puts the whole
  // note inside its back-link.
  const tidy = (el: Element) =>
    (el.textContent || '')
      .replace(/[↩↑⤴]︎?/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const backHrefs = new Set(idsAt(a).map((id) => `#${id}`));
  const body = block.cloneNode(true) as Element;
  body.querySelectorAll('a[href]').forEach((l) => {
    if (backHrefs.has(hashOf(l))) l.remove();
  });
  const text = tidy(body) || tidy(block);
  if (!text || text.length > MAX_NOTE_CHARS) return null;
  return text;
}
