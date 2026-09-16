// Markdown → the reader's text stream. Structure travels as the block and
// style marks described in parse-text.ts, so the typewriter still types only
// the words and the renderer paints headings, lists, quotes, code and tables.

import type { MarkedToken, Token, Tokens } from 'marked';
import { extractTxt } from './extract-txt';
import { MARK_BLOCK, MARK_END, MARK_STYLE, MARK_STYLE_END } from './parse-text';

export interface LoadedMd {
  text: string;
  /** The plain-text conversion md books were read as before formatting was
   * rendered. Only its hash is used — see `LoadedText.identityText`. */
  identityText: string;
}

export async function loadMd(file: File): Promise<LoadedMd> {
  const raw = await extractTxt(file);
  const { lexer } = await import('marked');
  // A stray private-use character in the file would read as one of our marks.
  const body = stripFrontmatter(raw).replace(/[-]/g, '');
  return { text: mdTokensToText(lexer(body)), identityText: mdToPlainText(raw) };
}

// Strip YAML frontmatter at file start (---\n...\n---). Common in
// Obsidian / Jekyll / Hugo notes; would otherwise read as garbage (and to
// marked, as a rule followed by a heading).
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

interface Line {
  kind: string;
  text: string;
}

/** Soft line break inside a paragraph, resolved once the line is whole. */
const SOFT = '';
const STYLE_MARK_RE = /[^]*|/g;
const CJK_RE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/;
const SEP = style('sep', ' │ ');

export function mdTokensToText(tokens: Token[]): string {
  const lines: Line[] = [];
  blocks(tokens, lines, 0, false);
  return lines.map((l) => (l.kind ? MARK_BLOCK + l.kind + MARK_END : '') + l.text).join('\n');
}

function blocks(tokens: Token[], out: Line[], depth: number, quote: boolean): void {
  // Nested structure flattens to the innermost kind that has a look: a
  // paragraph in a quote is a quote line, in a list item it is indented.
  const flow = quote ? 'quote' : depth ? `li:${depth}` : '';
  for (const t of tokens as MarkedToken[]) {
    switch (t.type) {
      case 'heading':
        push(out, `h${t.depth}`, inline(t.tokens).replace(/\n/g, ' '), '');
        break;
      case 'paragraph':
        push(out, flow, inline(t.tokens), flow);
        break;
      case 'text':
        push(out, flow, t.tokens ? inline(t.tokens) : soft(decodeEntities(t.text)), flow);
        break;
      case 'blockquote':
        blocks(t.tokens, out, depth, true);
        break;
      case 'list':
        list(t, out, depth + 1);
        break;
      case 'code': {
        // `code:t` / `code:e` flag the fence's first and last line, where the
        // box gets its padding — CSS can't see across the separate blocks.
        const code = t.text.split('\n');
        code.forEach((text, i) => {
          const edge = (i === 0 ? 't' : '') + (i === code.length - 1 ? 'e' : '');
          out.push({ kind: edge ? `code:${edge}` : 'code', text });
        });
        break;
      }
      case 'table':
        out.push({ kind: 'thead', text: cells(t.header) });
        for (const row of t.rows) out.push({ kind: 'row', text: cells(row) });
        break;
      case 'hr':
        out.push({ kind: 'hr', text: '' });
        break;
      case 'html':
        push(out, flow, htmlText(t.text), flow);
        break;
      // space, def (link reference definitions), checkbox (handled by the
      // list) and extension tokens carry no prose of their own.
    }
  }
}

function list(t: Tokens.List, out: Line[], depth: number): void {
  let n = t.start === '' ? 1 : t.start;
  for (const item of t.items) {
    const kind = t.ordered ? `ol:${depth}:${n++}` : `ul:${depth}`;
    const box = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
    const at = out.length;
    blocks(item.tokens, out, depth, false);
    const first = out[at];
    if (first?.kind === `li:${depth}`) {
      first.kind = kind;
      first.text = box + first.text;
    } else {
      // The item opens with a code block or a nested list; the marker gets a
      // line of its own (and vanishes with it when there is nothing to type).
      out.splice(at, 0, { kind, text: box });
    }
  }
}

/** Hard breaks (`\n`) split the text into lines; the first gets `kind`, the
 * rest `cont`. Lines with nothing to type are dropped. */
function push(out: Line[], kind: string, text: string, cont: string): void {
  text.split('\n').forEach((part, i) => {
    const line = resolveSoftBreaks(part);
    if (line.replace(STYLE_MARK_RE, '').trim()) out.push({ kind: i ? cont : kind, text: line });
  });
}

function inline(tokens: Token[]): string {
  let s = '';
  for (const t of tokens as MarkedToken[]) {
    switch (t.type) {
      case 'text':
        s += t.tokens ? inline(t.tokens) : soft(decodeEntities(t.text));
        break;
      case 'escape':
        s += t.text;
        break;
      case 'strong':
        s += style('b', inline(t.tokens));
        break;
      case 'em':
        s += style('i', inline(t.tokens));
        break;
      case 'del':
        s += style('s', inline(t.tokens));
        break;
      case 'codespan':
        s += style('code', t.text);
        break;
      case 'link':
        // Relative links point into a folder we never saw; only web and mail
        // links become clickable, and never a `javascript:` one.
        s += style(/^(https?|mailto):/i.test(t.href) ? `a:${t.href}` : '', inline(t.tokens));
        break;
      case 'br':
        s += '\n';
        break;
      case 'html':
        if (/^<br\s*\/?>$/i.test(t.text.trim())) s += '\n';
        break;
      // Images are dropped, as they always were: there is no asset map for a
      // lone .md file.
    }
  }
  return s;
}

function cells(row: Tokens.TableCell[]): string {
  return row.map((c) => resolveSoftBreaks(inline(c.tokens).replace(/\n/g, ' '))).join(SEP);
}

function style(kind: string, inner: string): string {
  return kind && inner ? MARK_STYLE + kind + MARK_END + inner + MARK_STYLE_END : inner;
}

function soft(s: string): string {
  return s.replace(/\n/g, SOFT);
}

/** A wrapped line joins its neighbour with a space, except around CJK text,
 * where the source's line breaks are not word breaks. Decided on the visible
 * characters, so a break next to `**` looks past the mark. */
function resolveSoftBreaks(line: string): string {
  if (!line.includes(SOFT)) return line;
  const visible = line.replace(STYLE_MARK_RE, '');
  const joins: string[] = [];
  for (let i = visible.indexOf(SOFT); i >= 0; i = visible.indexOf(SOFT, i + 1)) {
    const a = visible[i - 1] ?? '';
    const b = visible[i + 1] ?? '';
    const tight = !a || !b || /\s/.test(a + b) || CJK_RE.test(a) || CJK_RE.test(b);
    joins.push(tight ? '' : ' ');
  }
  let k = 0;
  return line.replace(//g, () => joins[k++]);
}

function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  );
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

/** marked leaves entities as written. Only the common ones are decoded — no
 * DOM here — and never into our own mark range. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xe000 && cp <= 0xe00f);
    return ok ? String.fromCodePoint(cp) : m;
  });
}

/**
 * The conversion md books were read with before formatting was rendered.
 * FROZEN: md books are still keyed by the hash of this output, so changing
 * any regex here re-keys every saved Markdown book (lost place, cached file
 * orphaned). Fix reading bugs in `mdTokensToText` instead.
 */
export function mdToPlainText(md: string): string {
  let body = stripFrontmatter(md);
  // Strip fenced code blocks but keep the content as-is for reading.
  body = body.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_, c) => c);
  // Inline code: keep contents
  body = body.replace(/`([^`]+)`/g, '$1');
  // Images: drop entirely (we don't render them)
  body = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: keep label, drop URL
  body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Bold / italic / strikethrough: keep content
  body = body.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  body = body.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
  body = body.replace(/~~([^~]+)~~/g, '$1');
  // Horizontal rules → blank line
  body = body.replace(/^[\s]*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  // Blockquotes: drop the leading `>`
  body = body.replace(/^>\s?/gm, '');
  // List bullets / numbers: drop the leading marker, keep text
  body = body.replace(/^[ \t]*[-*+]\s+/gm, '');
  body = body.replace(/^[ \t]*\d+\.\s+/gm, '');
  // Tables: drop separator rows; keep cell text joined with spaces
  body = body.replace(/^\|?[\s:|-]+\|?\s*$/gm, '');
  body = body.replace(/^\|(.+)\|\s*$/gm, (_, row) =>
    row.split('|').map((c: string) => c.trim()).filter(Boolean).join('  ')
  );
  // Headings → keep the text as a standalone line.
  body = body.replace(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm, '$2');
  return body;
}
