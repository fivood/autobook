// Minimal EPUB → plaintext for the typewriter. We unzip, read the OPF
// rootfile, walk the spine in reading order, and concatenate the textContent
// of each chapter's HTML. Section headings (h1/h2/h3) become standalone lines
// so the chapter detector in parse-text.ts picks them up automatically.

import { BlobReader, BlobWriter, TextWriter, ZipReader, type Entry } from '@zip.js/zip.js';

interface FileEntry {
  filename: string;
  directory: boolean;
  getData(writer: TextWriter): Promise<string>;
  getDataBlob(writer: BlobWriter): Promise<Blob>;
}

export interface LoadedEpub {
  title: string;
  text: string;
  /** Data-URL (base64) form of the cover image so it can survive a JSON
   * round-trip into localStorage with the recent-read entry. */
  coverDataUrl?: string;
}

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
      const coverEntry = byPath.get(coverHref.toLowerCase()) as unknown as FileEntry | undefined;
      // zip.js's FileEntry.getData() isn't in its shipped TS types; reach through `as any`.
      if (coverEntry && typeof (coverEntry as any).getData === 'function') {
        try {
          const blob = await (coverEntry as any).getData(new BlobWriter(mimeFromExt(coverHref)));
          coverDataUrl = await blobToDataUrl(blob as Blob);
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

    const chunks: string[] = [];
    for (const href of spineHrefs) {
      const entry = byPath.get(href.toLowerCase());
      if (!entry) continue;
      const html = await entry.getData(new TextWriter('utf-8'));
      const text = htmlToPlainText(html);
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

    const cleanedTitle = title || file.name.replace(/\.[^.]+$/, '');
    return { title: cleanedTitle, text: chunks.filter(Boolean).join('\n\n'), coverDataUrl };
  } finally {
    await reader.close();
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

function htmlToPlainText(html: string): string {
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

  const lines: string[] = [];
  walk(body, lines);
  return lines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

function walk(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent;
    if (t) out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const isHeading = HEADING_TAGS.has(tag);
  const isBlock = isHeading || BLOCK_TAGS.has(tag);
  if (isBlock) out.push('\n');
  for (const child of Array.from(el.childNodes)) walk(child, out);
  if (isBlock) out.push('\n');
}
