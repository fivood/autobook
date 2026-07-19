/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * MOBI / AZW3 loader. The actual parsing happens in Rust (mobi crate via the
 * `parse_mobi` Tauri command) — here we just marshal bytes in/out and stitch
 * the result into the same LoadData shape epub/htmlz/txt produce.
 */

import { invoke } from '@tauri-apps/api/core';
import type { LoadData } from '$lib/functions/file-loaders/types';
import type { Section } from '$lib/data/database/books-db/versions/books-db';
import loadEpub from '$lib/functions/file-loaders/epub/load-epub';

interface ParsedMobiImage {
  index: number;
  ext: string;
  data: string;
}

interface ParsedMobi {
  title: string;
  author: string;
  language: string | null;
  html: string;
  images: ParsedMobiImage[];
  cover_index: number;
  /** True when the html came from KF8 Phase 3 fragment reassembly. Skips
   * the DOMParser round-trip + attribute-leak fixup since those defects
   * are MOBI6-only. */
  well_formed?: boolean;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif'
};

/** Inside the HTML, image refs look like `recindex:00042` (1-based index into
 * the images array). Swap those for blob URLs we register via a fake path the
 * existing reader pipeline already knows how to resolve. */
function rewriteImageRefs(
  html: string,
  blobsByName: Record<string, Blob>,
  images: ParsedMobiImage[]
): string {
  const indexToName = new Map<number, string>();
  for (const img of images) {
    const name = `mobi-img-${img.index}.${img.ext}`;
    indexToName.set(img.index, name);
    blobsByName[name] = base64ToBlob(img.data, EXT_TO_MIME[img.ext] || 'image/jpeg');
  }
  return html.replace(/recindex:(\d{4,6})/gi, (full, digits) => {
    const idx = parseInt(digits, 10);
    const name = indexToName.get(idx);
    return name ? name : full;
  });
}

/** Orphan tag-attribute fragments like `1em" width="2em" align="justify">` show
 * up in MOBI6 content where record boundaries chopped the opening `<tag`. They
 * survive DOMParser as plain text. Two patterns:
 * 1) Full attr pairs: `name="value"` runs (possibly starting with a partial
 *    CSS value like `1em"`)
 * 2) Lone closing fragment: a short value + `">` at the start of a text node */
const ATTR_LEAK_RE =
  /(?:[^\s"<>]{0,20}"\s+)?(?:[a-zA-Z][\w-]*\s*=\s*"[^"<>]{0,40}"\s*){1,5}>?/g;
const LONE_CLOSE_RE = /^[^"<>]{0,30}"?\s*>/;

function stripAttributeLeaks(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node.nodeValue || '';
    if (text.includes('="') || LONE_CLOSE_RE.test(text)) {
      let cleaned = text.replace(ATTR_LEAK_RE, '');
      cleaned = cleaned.replace(LONE_CLOSE_RE, '');
      if (cleaned !== text) node.nodeValue = cleaned;
    }
    node = walker.nextNode();
  }
}

/** MOBI6 HTML is often a fragment with orphaned tag attributes leaking
 * after partial pagebreak splits. Feed it through DOMParser so the browser's
 * tolerant parser fixes most malformations, strip attribute leaks in text
 * nodes, then re-serialize.
 *
 * For KF8 Phase 3 (`wellFormed` = true) the HTML is byte-accurate XHTML
 * from skeleton+fragment reassembly and has no attribute leaks, so we
 * skip DOMParser entirely — a ~100-500ms savings on a 4MB flow 0. Still
 * run the font-family regex strip inline since it's O(n) on the raw
 * string and doesn't need a DOM. */
function cleanHtml(raw: string, wellFormed: boolean): string {
  if (wellFormed) {
    return stripEmbeddedFontsRegex(raw);
  }
  try {
    const wrapped = `<!doctype html><html><body><div id="autobook-mobi-root">${raw}</div></body></html>`;
    const doc = new DOMParser().parseFromString(wrapped, 'text/html');
    const root = doc.getElementById('autobook-mobi-root');
    if (!root) return raw;
    stripAttributeLeaks(root);
    stripEmbeddedFonts(root);
    return root.innerHTML;
  } catch {
    return raw;
  }
}

const FONT_FAMILY_RE = /font-family\s*:[^;}"']+[;]?/gi;

function stripEmbeddedFontsRegex(html: string): string {
  // The regex is safe to apply to the raw HTML string — it matches CSS
  // declaration syntax that only occurs inside <style> blocks and style
  // attribute values in practice. False positives (matching plain text
  // that happens to contain `font-family:`) would be exotic.
  return html.replace(FONT_FAMILY_RE, '');
}

function stripEmbeddedFonts(root: HTMLElement) {
  root.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent || '').replace(FONT_FAMILY_RE, '');
  });
  root.querySelectorAll('[style]').forEach((el) => {
    const s = el.getAttribute('style') || '';
    if (/font-family/i.test(s)) {
      el.setAttribute('style', s.replace(FONT_FAMILY_RE, ''));
    }
  });
}

/** mobi crate gives us one concatenated HTML blob. Split into sections on
 * KF8 pagebreak markers so the reader's TOC + char-count machinery work. */
function splitIntoSections(html: string): { sectionedHtml: string; sections: Section[] } {
  const pagebreakRe =
    /<(?:mbp:pagebreak|p\s+style="page-break-after:\s*always[^"]*"|div\s+class="mbp_pagebreak")\s*\/?>(?:<\/(?:mbp:pagebreak|p|div)>)?/gi;
  const parts = html.split(pagebreakRe).filter((p) => p.trim().length > 0);
  if (parts.length === 0) {
    parts.push(html);
  }
  // Rust side emits `<!--autobook-section-label:TITLE-->` at the start of
  // each KF8 section carrying the CNCX chapter title (Phase 3 with CNCX).
  // Prefer that over scanning `<h*>` since the CNCX pool matches the epub
  // source's nav.xhtml titles, which are often more accurate than the
  // heading text (e.g. "第一章 · 波洛的调查" vs bare "第一章").
  const rustLabelRe = /^\s*<!--autobook-section-label:([\s\S]*?)-->/;
  const headingLabelRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i;
  let totalChars = 0;
  const sections: Section[] = [];
  const sectionedParts: string[] = [];
  parts.forEach((body, i) => {
    const id = `section-${i + 1}`;
    let rawLabel = '';
    const rustMatch = rustLabelRe.exec(body);
    if (rustMatch) {
      rawLabel = rustMatch[1];
    } else {
      const hm = headingLabelRe.exec(body);
      rawLabel = hm ? hm[2] : '';
    }
    const label = rawLabel.replace(/<[^>]*>/g, '').trim() || id;
    // textContent measured via stripping tags; close enough for char counts.
    const text = body.replace(/<[^>]*>/g, '');
    const chars = Array.from(text).length;
    sections.push({
      reference: id,
      charactersWeight: chars || 1,
      label,
      startCharacter: totalChars,
      characters: chars
    });
    totalChars += chars;
    sectionedParts.push(`<div id="${id}" class="mobi-section">${body}</div>`);
  });
  return { sectionedHtml: sectionedParts.join('\n'), sections };
}

function languageHint(lang: string | null): string {
  if (!lang) return 'zh';
  const l = lang.toLowerCase();
  if (l.includes('jp') || l.includes('japan')) return 'ja';
  if (l.includes('zh') || l.includes('chin')) return 'zh';
  if (l.includes('en')) return 'en';
  return 'zh';
}

async function tryCalibConvert(file: File, lastBookModified: number): Promise<LoadData | null> {
  try {
    const hasCalibre = await invoke<boolean>('check_calibre');
    if (!hasCalibre) return null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const epubBytes = await invoke<number[]>('convert_with_calibre', {
      bytes: Array.from(bytes),
      filename: file.name
    });
    const epubBlob = new Blob([new Uint8Array(epubBytes)], {
      type: 'application/epub+zip'
    });
    const epubFile = new File([epubBlob], file.name.replace(/\.[^.]+$/, '.epub'), {
      type: 'application/epub+zip'
    });
    return await loadEpub(epubFile, document, lastBookModified);
  } catch {
    return null;
  }
}

const CALIBRE_HINT =
  '\n\n建议：原生 MOBI/AZW3 解析器对复杂 KF8 文件（合订本 / 漫画包 / 多卷本）兼容性有限，' +
  '安装 Calibre（https://calibre-ebook.com）后重试即可——AutoBook 检测到 Calibre 会自动调用它先转 EPUB 再导入，成功率显著更高。';

function extractTauriError(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
    try {
      const dumped = JSON.stringify(e);
      if (dumped && dumped !== '{}') return dumped;
    } catch {
      /* fall through */
    }
  }
  // Tauri sometimes resolves with a raw rejection that serializes to {}; in
  // that case we can't recover the Rust-side error string. Surface a clear
  // sentinel so the upstream catch can suggest Calibre rather than printing
  // an empty object.
  return '原生 MOBI/AZW3 解析器在此文件上失败（无可用错误信息）';
}

async function nativeParse(file: File, lastBookModified: number): Promise<LoadData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed: ParsedMobi;
  try {
    parsed = await invoke<ParsedMobi>('parse_mobi', { bytes: Array.from(bytes) });
  } catch (e) {
    throw new Error(extractTauriError(e) + CALIBRE_HINT);
  }

  const blobs: Record<string, Blob> = {};
  const rewrittenHtml = rewriteImageRefs(parsed.html, blobs, parsed.images);
  const cleaned = cleanHtml(rewrittenHtml, !!parsed.well_formed);
  const { sectionedHtml, sections } = splitIntoSections(cleaned);

  let coverImage: Blob | undefined;
  if (parsed.cover_index > 0) {
    const cover = parsed.images.find((img) => img.index === parsed.cover_index);
    if (cover) {
      coverImage = base64ToBlob(cover.data, EXT_TO_MIME[cover.ext] || 'image/jpeg');
    }
  }

  const fallbackTitle = file.name;
  return {
    title: parsed.title || fallbackTitle,
    language: languageHint(parsed.language),
    styleSheet: '.mobi-section, .mobi-section * { font-family: inherit !important; }',
    elementHtml: sectionedHtml,
    blobs,
    coverImage,
    hasThumb: !!coverImage,
    characters: sections.reduce((sum, s) => sum + (s.characters || 0), 0),
    sections,
    lastBookModified,
    lastBookOpen: 0
  };
}

let forceNative = false;

export function setForceNativeParser(val: boolean) {
  forceNative = val;
}

export default async function loadMobi(file: File, lastBookModified: number): Promise<LoadData> {
  if (!forceNative) {
    const calibreResult = await tryCalibConvert(file, lastBookModified);
    if (calibreResult) return calibreResult;
  }
  return nativeParse(file, lastBookModified);
}
