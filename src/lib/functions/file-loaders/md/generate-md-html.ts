/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Markdown → sectioned HTML, modeled after generate-txt-html.ts so the rest
 * of the reader (TOC, char counts, pagination) doesn't need to know about MD.
 */

import { Marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import type { Section } from '$lib/data/database/books-db/versions/books-db';
import { sanitizeHtml } from '$lib/functions/sanitize-html';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;

/** Render `$$...$$` (block) and `$...$` (inline) via KaTeX. We do this BEFORE
 * marked sees the text so the produced HTML survives marked's paragraph
 * wrapping. KaTeX HTML uses class names — its CSS is loaded once globally. */
function renderMath(text: string): string {
  // Block math: $$...$$  (allow it to span lines)
  let out = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    try {
      return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<code class="math-error">$$${escapeHtml(expr)}$$</code>`;
    }
  });
  // Inline math: $...$ but don't match currency-like single $.
  out = out.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, prefix, expr) => {
    try {
      return prefix + katex.renderToString(expr, { displayMode: false, throwOnError: false });
    } catch {
      return `${prefix}<code class="math-error">$${escapeHtml(expr)}$</code>`;
    }
  });
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c] as string);
}

function configureMarked(): Marked {
  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      code(this: unknown, { text, lang }: { text: string; lang?: string }) {
        const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
        try {
          const highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value;
          return `<pre class="md-code"><code class="hljs language-${language}">${highlighted}</code></pre>`;
        } catch {
          return `<pre class="md-code"><code class="hljs">${escapeHtml(text)}</code></pre>`;
        }
      }
    }
  });
  return marked;
}

const charCountOf = (s: string) => Array.from(s).length;

export function getFormattedElementMd(data: string) {
  const marked = configureMarked();
  const result = document.createElement('div');
  const sections: Section[] = [];

  // Strip YAML frontmatter (---\n...\n---) before anything else — Obsidian /
  // Jekyll / Hugo notes routinely start with a metadata block that's not
  // part of the readable body.
  const withoutFrontmatter = data.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Pre-render math so marked doesn't mangle the LaTeX.
  const withMath = renderMath(withoutFrontmatter);

  // Split on top-level headings (# / ##) for TOC sections. Lower-level
  // headings stay inside the section.
  const lines = withMath.split(/\r?\n/);
  const sectionBuckets: { label: string; lines: string[] }[] = [
    { label: '', lines: [] }
  ];
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m && m[1].length <= 2) {
      sectionBuckets.push({ label: m[2].trim(), lines: [line] });
    } else {
      sectionBuckets[sectionBuckets.length - 1].lines.push(line);
    }
  }
  // Drop the leading empty bucket if it has no body content.
  if (sectionBuckets[0].lines.every((l) => !l.trim())) {
    sectionBuckets.shift();
  }
  if (!sectionBuckets.length) {
    sectionBuckets.push({ label: '', lines: [withMath] });
  }

  let totalChars = 0;
  sectionBuckets.forEach((bucket, idx) => {
    const sectionId = `section-${idx + 1}`;
    const html = marked.parse(bucket.lines.join('\n'), { async: false }) as string;
    const wrapper = document.createElement('div');
    wrapper.id = sectionId;
    wrapper.className = 'md-section';
    // Markdown allows raw HTML passthrough, so marked's output carries
    // whatever the author wrote.
    wrapper.innerHTML = sanitizeHtml(html);
    const text = wrapper.textContent || '';
    const chars = charCountOf(text);
    sections.push({
      reference: sectionId,
      charactersWeight: chars || 1,
      label: bucket.label || sectionId,
      startCharacter: totalChars,
      characters: chars
    });
    totalChars += chars;
    result.appendChild(wrapper);
  });

  return { element: result, characters: totalChars, sections };
}
