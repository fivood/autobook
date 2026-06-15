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

/** mobi HTML is often a fragment with orphaned tag attributes leaking
 * after partial pagebreak splits. Feed it through DOMParser so the browser's
 * tolerant parser fixes most malformations, then re-serialize. */
function cleanHtml(raw: string): string {
  try {
    const wrapped = `<!doctype html><html><body><div id="autobook-mobi-root">${raw}</div></body></html>`;
    const doc = new DOMParser().parseFromString(wrapped, 'text/html');
    const root = doc.getElementById('autobook-mobi-root');
    return root ? root.innerHTML : raw;
  } catch {
    return raw;
  }
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
  // Try to harvest a heading per section for a friendlier TOC label.
  const labelRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i;
  let totalChars = 0;
  const sections: Section[] = [];
  const sectionedParts: string[] = [];
  parts.forEach((body, i) => {
    const id = `section-${i + 1}`;
    const match = labelRe.exec(body);
    const rawLabel = match ? match[2] : '';
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

export default async function loadMobi(file: File, lastBookModified: number): Promise<LoadData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await invoke<ParsedMobi>('parse_mobi', { bytes: Array.from(bytes) });

  const blobs: Record<string, Blob> = {};
  const rewrittenHtml = rewriteImageRefs(parsed.html, blobs, parsed.images);
  const cleaned = cleanHtml(rewrittenHtml);
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
    styleSheet: '',
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
