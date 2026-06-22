// Minimal EPUB → plaintext for the typewriter. We unzip, read the OPF
// rootfile, walk the spine in reading order, and concatenate the textContent
// of each chapter's HTML. Section headings (h1/h2/h3) become standalone lines
// so the chapter detector in parse-text.ts picks them up automatically.

import { BlobReader, TextWriter, ZipReader, type Entry } from '@zip.js/zip.js';

interface FileEntry {
  filename: string;
  directory: boolean;
  getData(writer: TextWriter): Promise<string>;
}

export interface LoadedEpub {
  title: string;
  text: string;
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

    const { title, spineHrefs } = parseOpf(opfXml, opfPath);
    if (!spineHrefs.length) throw new Error('OPF 的 spine 为空');

    const chunks: string[] = [];
    for (const href of spineHrefs) {
      const entry = byPath.get(href.toLowerCase());
      if (!entry) continue;
      const html = await entry.getData(new TextWriter('utf-8'));
      chunks.push(htmlToPlainText(html));
    }

    const cleanedTitle = title || file.name.replace(/\.[^.]+$/, '');
    return { title: cleanedTitle, text: chunks.filter(Boolean).join('\n\n') };
  } finally {
    await reader.close();
  }
}

function extractOpfPath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfile = doc.querySelector('rootfile');
  return rootfile?.getAttribute('full-path') ?? null;
}

interface OpfParsed {
  title: string;
  spineHrefs: string[];
}

function parseOpf(opfXml: string, opfPath: string): OpfParsed {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const titleEl = doc.querySelector('metadata > title, metadata title');
  const title = titleEl?.textContent?.trim() || '';

  const manifest = new Map<string, string>();
  doc.querySelectorAll('manifest > item, manifest item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const spineHrefs: string[] = [];
  doc.querySelectorAll('spine > itemref, spine itemref').forEach((ref) => {
    const idref = ref.getAttribute('idref');
    if (!idref) return;
    const href = manifest.get(idref);
    if (!href) return;
    spineHrefs.push(resolvePath(opfDir + href));
  });

  return { title, spineHrefs };
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
