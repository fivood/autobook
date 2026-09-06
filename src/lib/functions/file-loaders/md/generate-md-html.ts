/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Markdown → sectioned HTML, modeled after generate-txt-html.ts so the rest
 * of the reader (TOC, char counts, pagination) doesn't need to know about MD.
 */

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import katex from 'katex';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { Section } from '$lib/data/database/books-db/versions/books-db';
import { sanitizeHtml } from '$lib/functions/sanitize-html';

// The default `highlight.js` entry point pulls in ~190 grammars — Erlang,
// Smalltalk, the lot — for a reading app that meets code blocks occasionally.
// Register the plausible ones; anything else falls back to plaintext, which is
// what an unrecognized language tag already did.
for (const [name, language] of Object.entries({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  ruby,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml
})) {
  hljs.registerLanguage(name, language);
}

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
    // Markdown passes raw HTML straight through, so marked's output carries
    // whatever the author wrote. Sanitizing here rather than only at render
    // time matters because the text-source editor feeds this element's
    // innerHTML into `{@html}` for its live preview, which never goes through
    // formatBookDataHtml.
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
