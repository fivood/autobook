// Minimal EPUB → plaintext for the typewriter. We unzip, read the OPF
// rootfile, walk the spine in reading order, and concatenate the textContent
// of each chapter's HTML. Section headings (h1/h2/h3) become standalone lines
// so the chapter detector in parse-text.ts picks them up automatically.
//
// Two things don't survive a plain string, so they travel beside it:
//   - images, as a key → Blob map the reader turns into blob URLs
//   - footnote bodies, as an id → text map the reader shows in a sheet
// Their *positions* do ride inside the text, as the private-use sentinels
// defined in parse-text.ts, which strips them back out before any offset is
// measured. Footnote bodies are lifted out of the flow entirely — left in,
// they land as a wall of unlabelled paragraphs at the end of every chapter.

import { BlobReader, BlobWriter, TextWriter, ZipReader, type Entry } from '@zip.js/zip.js';
import { MARK_END, MARK_IMG, MARK_NOTE, MARK_SEP } from './parse-text';

interface FileEntry {
  filename: string;
  directory: boolean;
  // zip.js's shipped types don't expose Entry.getData; declare the two
  // writer shapes we use. The writer decides the return type.
  getData(writer: TextWriter): Promise<string>;
  getData(writer: BlobWriter): Promise<Blob>;
}

export interface LoadedEpub {
  title: string;
  text: string;
  /** Data-URL (base64) form of the cover image so it can survive a JSON
   * round-trip into localStorage with the recent-read entry. */
  coverDataUrl?: string;
  /** Resolved, lower-cased zip path → image blob, for every image the text
   * actually references. Not persisted: reopening re-extracts from the
   * cached original file. */
  images: Map<string, Blob>;
  /** Footnote id → body text, keyed to the markers embedded in `text`. */
  notes: Map<string, string>;
}

/** Attributes stamped onto a footnote reference during the pre-pass so the
 * text walk can emit a marker without re-running the detection. */
const NOTE_ID_ATTR = 'data-tw-note';
const NOTE_NUM_ATTR = 'data-tw-note-n';

function mimeFromExt(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function loadEpub(file: File): Promise<LoadedEpub> {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const allEntries = await reader.getEntries();
    const entries = allEntries.filter(
      (e: Entry): e is Entry & FileEntry =>
        !e.directory && typeof (e as unknown as FileEntry).getData === 'function'
    ) as unknown as FileEntry[];
    const byPath = new Map(entries.map((e) => [e.filename.toLowerCase(), e]));

    const containerEntry = byPath.get('meta-inf/container.xml');
    if (!containerEntry) {
      throw new Error('container.xml 缺失，可能不是合法 EPUB');
    }
    const containerXml = await containerEntry.getData(new TextWriter('utf-8'));
    const opfPath = extractOpfPath(containerXml);
    if (!opfPath) throw new Error('找不到 OPF 引用');

    const opfEntry = byPath.get(opfPath.toLowerCase());
    if (!opfEntry) throw new Error(`OPF 文件不存在：${opfPath}`);
    const opfXml = await opfEntry.getData(new TextWriter('utf-8'));

    const { title, spineHrefs, tocHref, coverHref } = parseOpf(opfXml, opfPath);
    if (!spineHrefs.length) throw new Error('OPF 的 spine 为空');

    let coverDataUrl: string | undefined;
    if (coverHref) {
      const coverEntry = byPath.get(coverHref.toLowerCase());
      if (coverEntry) {
        try {
          const blob = await coverEntry.getData(new BlobWriter(mimeFromExt(coverHref)));
          coverDataUrl = await blobToDataUrl(blob);
        } catch {
          // cover failure shouldn't block the book
        }
      }
    }

    // Resolve the publisher-supplied TOC (EPUB3 nav.xhtml or EPUB2 .ncx) to
    // a map of spine-href → chapter title. parse-text.ts recognises those
    // titles as chapter headings and gives them h2 styling, which is much
    // more faithful than guessing chapter boundaries from text.
    const tocLabels = new Map<string, string>();
    if (tocHref) {
      const tocEntry = byPath.get(tocHref.toLowerCase());
      if (tocEntry) {
        try {
          const tocXml = await tocEntry.getData(new TextWriter('utf-8'));
          const tocDir = tocHref.includes('/') ? tocHref.slice(0, tocHref.lastIndexOf('/') + 1) : '';
          parseTocLabels(tocXml, tocDir, tocLabels);
        } catch {
          // toc parse failure → just lose chapter labels, content still loads
        }
      }
    }

    const notes = new Map<string, string>();
    const imageRefs = new Set<string>();

    const chunks: string[] = [];
    for (const [spineIndex, href] of spineHrefs.entries()) {
      const entry = byPath.get(href.toLowerCase());
      if (!entry) continue;
      const html = await entry.getData(new TextWriter('utf-8'));
      const dir = href.includes('/') ? href.slice(0, href.lastIndexOf('/') + 1) : '';
      // Footnote ids restart at B_1 in every chapter file of a Sigil/Duokan
      // build, so the spine index is what keeps them apart across the book.
      const text = htmlToPlainText(html, String(spineIndex), dir, notes, imageRefs);
      if (!text) continue;
      const label = tocLabels.get(href);
      if (label && !startsWithLine(text, label)) {
        // Prefix the chapter title as its own line so parse-text.ts picks it
        // up as a heading. Skip if the body already starts with that line
        // (some EPUBs include the title inside the content too).
        chunks.push(`${label}\n\n${text}`);
      } else {
        chunks.push(text);
      }
    }

    // Only referenced images get inflated — an EPUB's manifest routinely
    // carries plates no spine document ever points at.
    const images = new Map<string, Blob>();
    for (const key of imageRefs) {
      const imgEntry = lookupEntry(byPath, key);
      if (!imgEntry) continue;
      try {
        images.set(key, await imgEntry.getData(new BlobWriter(mimeFromExt(key))));
      } catch {
        // one unreadable image shouldn't cost the reader the whole book
      }
    }

    const cleanedTitle = title || file.name.replace(/\.[^.]+$/, '');
    return {
      title: cleanedTitle,
      text: chunks.filter(Boolean).join('\n\n'),
      coverDataUrl,
      images,
      notes
    };
  } finally {
    await reader.close();
  }
}

/** Zip entry names are stored as raw UTF-8 while hrefs inside the package are
 * percent-encoded, and real files are inconsistent about it — try both
 * spellings before giving up. */
function lookupEntry(byPath: Map<string, FileEntry>, key: string): FileEntry | undefined {
  const hit = byPath.get(key);
  if (hit) return hit;
  try {
    return byPath.get(decodeURIComponent(key));
  } catch {
    // malformed percent-encoding — nothing else to try
    return undefined;
  }
}

function startsWithLine(text: string, candidate: string): boolean {
  const firstLine = text.split('\n', 1)[0].trim();
  return firstLine === candidate.trim();
}

function extractOpfPath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfile = doc.querySelector('rootfile');
  return rootfile?.getAttribute('full-path') ?? null;
}

interface OpfParsed {
  title: string;
  spineHrefs: string[];
  /** Absolute path to the TOC file (nav.xhtml for EPUB3, .ncx for EPUB2). */
  tocHref?: string;
  /** Absolute path to the cover image, if discoverable in the OPF. */
  coverHref?: string;
}

function parseOpf(opfXml: string, opfPath: string): OpfParsed {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const titleEl = doc.querySelector('metadata > title, metadata title');
  const title = titleEl?.textContent?.trim() || '';

  const manifest = new Map<string, { href: string; properties: string; mediaType: string }>();
  doc.querySelectorAll('manifest > item, manifest item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, {
        href,
        properties: item.getAttribute('properties') || '',
        mediaType: item.getAttribute('media-type') || ''
      });
    }
  });

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // EPUB3: <item properties="nav">  EPUB2: <spine toc="ncx-id">
  let tocHref: string | undefined;
  for (const m of manifest.values()) {
    if (m.properties.split(/\s+/).includes('nav')) {
      tocHref = resolvePath(opfDir + m.href);
      break;
    }
  }
  if (!tocHref) {
    const spineEl = doc.querySelector('spine');
    const ncxId = spineEl?.getAttribute('toc');
    if (ncxId) {
      const ncxItem = manifest.get(ncxId);
      if (ncxItem) tocHref = resolvePath(opfDir + ncxItem.href);
    }
  }

  const spineHrefs: string[] = [];
  doc.querySelectorAll('spine > itemref, spine itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref');
    if (!idref) return;
    const item = manifest.get(idref);
    if (!item) return;
    spineHrefs.push(resolvePath(opfDir + item.href));
  });

  // Cover discovery: EPUB3 uses properties="cover-image"; EPUB2 uses
  // <meta name="cover" content="ITEM_ID"> in metadata.
  let coverHref: string | undefined;
  for (const m of manifest.values()) {
    if (m.properties.split(/\s+/).includes('cover-image')) {
      coverHref = resolvePath(opfDir + m.href);
      break;
    }
  }
  if (!coverHref) {
    const coverMeta = doc.querySelector('metadata > meta[name="cover"], metadata meta[name="cover"]');
    const coverItemId = coverMeta?.getAttribute('content');
    if (coverItemId) {
      const coverItem = manifest.get(coverItemId);
      if (coverItem) coverHref = resolvePath(opfDir + coverItem.href);
    }
  }

  return { title, spineHrefs, tocHref, coverHref };
}

function parseTocLabels(tocXml: string, tocDir: string, labels: Map<string, string>) {
  // EPUB3 nav.xhtml: <nav epub:type="toc"><ol><li><a href="ch1.xhtml">…</a>
  // EPUB2 toc.ncx:   <navMap><navPoint><navLabel><text>…</text></navLabel>
  //                   <content src="ch1.xhtml"/></navPoint>
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(tocXml, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) {
      doc = new DOMParser().parseFromString(tocXml, 'application/xml');
    }
  } catch {
    doc = new DOMParser().parseFromString(tocXml, 'application/xml');
  }

  const addLabel = (href: string | null | undefined, label: string) => {
    if (!href || !label) return;
    // Strip fragment, resolve relative to TOC dir
    const cleanHref = href.split('#')[0].trim();
    if (!cleanHref) return;
    const abs = resolvePath(tocDir + cleanHref);
    const trimmed = label.replace(/\s+/g, ' ').trim();
    if (trimmed && !labels.has(abs)) labels.set(abs, trimmed);
  };

  // EPUB3 nav element first
  const navTocElement =
    doc.querySelector('nav[*|type="toc"]') ||
    doc.querySelector('nav[epub\\:type="toc"]') ||
    doc.querySelector('nav#toc') ||
    doc.querySelector('nav');
  if (navTocElement) {
    navTocElement.querySelectorAll('a').forEach((a) => {
      addLabel(a.getAttribute('href'), a.textContent || '');
    });
    if (labels.size > 0) return;
  }

  // EPUB2 NCX
  doc.querySelectorAll('navPoint').forEach((np) => {
    const labelEl = np.querySelector('navLabel > text') || np.querySelector('navLabel text');
    const contentEl = np.querySelector('content');
    addLabel(contentEl?.getAttribute('src'), labelEl?.textContent || '');
  });
}

function resolvePath(p: string): string {
  // collapse ./ and ../ segments
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function htmlToPlainText(
  html: string,
  fileKey: string,
  dir: string,
  notes: Map<string, string>,
  imageRefs: Set<string>
): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    // If XHTML parsing yielded a parsererror, fall back to text/html
    if (doc.querySelector('parsererror')) {
      doc = new DOMParser().parseFromString(html, 'text/html');
    }
  } catch {
    doc = new DOMParser().parseFromString(html, 'text/html');
  }

  const body = doc.body || doc.documentElement;
  body.querySelectorAll('script, style, svg').forEach((el) => el.remove());
  liftFootnotes(body, fileKey, notes);

  const out: string[] = [];
  walk(body, out, dir, imageRefs);
  // Joined with '' — `walk` emits its own '\n' around block elements, so the
  // pieces between them are inline and must stay on one line. Joining with
  // '\n' instead (as this did originally) split a paragraph at every inline
  // element: an <em>, a <span>, and now a footnote marker each became their
  // own "paragraph", and a marker alone on a line has no text to attach to
  // and was dropped outright.
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Does this in-page anchor look like a footnote reference rather than an
 * ordinary cross-link? Covers Duokan/Sigil (`class="duokan-footnote"`),
 * EPUB3 (`epub:type="noteref"`) and the bare `<sup>` convention. */
function isNoteRef(a: Element): boolean {
  // Back-links inside a note body point at the reference; treated as refs
  // they'd make each note swallow the paragraph it belongs to.
  if (
    a.parentElement?.closest(
      '[class*="footnote-item"], [class*="footnote-content"], [class*="endnote-item"], aside'
    )
  ) {
    return false;
  }
  const cls = a.getAttribute('class') || '';
  const epubType = a.getAttribute('epub:type') || '';
  return (
    /footnote|noteref|endnote/i.test(cls) ||
    /noteref/i.test(epubType) ||
    !!a.querySelector('sup') ||
    a.parentElement?.tagName?.toLowerCase() === 'sup'
  );
}

/**
 * Move footnote bodies out of the document into `notes`, and stamp each
 * reference with the id + display number the text walk will emit.
 *
 * Numbering is per file, matching how these books print it — ids restart at
 * B_1 in every chapter, and so does the visible "1".
 */
function liftFootnotes(body: Element, fileKey: string, notes: Map<string, string>) {
  // Index by id up front rather than building a selector per reference: ids in
  // the wild carry quotes, colons and spaces that would need escaping, and a
  // 400-note book would rebuild that selector 400 times.
  const byId = new Map<string, Element>();
  for (const el of Array.from(body.querySelectorAll('[id]'))) {
    const id = el.getAttribute('id');
    if (id && !byId.has(id)) byId.set(id, el);
  }

  let seq = 0;
  for (const a of Array.from(body.querySelectorAll('a[href^="#"]'))) {
    if (!isNoteRef(a)) continue;
    const raw = a.getAttribute('href')!.slice(1);
    if (!raw) continue;
    let targetId = raw;
    try {
      targetId = decodeURIComponent(raw);
    } catch {
      // href wasn't percent-encoded — the raw form is the id
    }
    const target = byId.get(targetId) ?? byId.get(raw);
    if (!target) continue;
    const text = (target.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seq += 1;
    const noteId = `${fileKey}:${targetId}`;
    notes.set(noteId, text);
    target.remove();
    a.setAttribute(NOTE_ID_ATTR, noteId);
    a.setAttribute(NOTE_NUM_ATTR, String(seq));
  }
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'li',
  'tr',
  'blockquote',
  'pre',
  'br',
  'hr'
]);

function walk(node: Node, out: string[], dir: string, imageRefs: Set<string>) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent;
    if (t) out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  const noteId = el.getAttribute(NOTE_ID_ATTR);
  if (noteId) {
    // Don't descend: the reference's own markup is a superscript image, and
    // its alt text ("注释1") would otherwise leak into the prose.
    out.push(`${MARK_NOTE}${el.getAttribute(NOTE_NUM_ATTR) || ''}${MARK_SEP}${noteId}${MARK_END}`);
    return;
  }

  if (tag === 'img' || tag === 'image') {
    const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
    // Remote and inline-data images have no zip entry to resolve against.
    if (src && !/^(https?:|data:|blob:)/i.test(src)) {
      const key = resolvePath(dir + src.split('#')[0].split('?')[0]).toLowerCase();
      imageRefs.add(key);
      out.push(`${MARK_IMG}${key}${MARK_END}`);
    }
    return;
  }

  const isHeading = HEADING_TAGS.has(tag);
  const isBlock = isHeading || BLOCK_TAGS.has(tag);
  if (isBlock) out.push('\n');
  for (const child of Array.from(el.childNodes)) walk(child, out, dir, imageRefs);
  if (isBlock) out.push('\n');
}
