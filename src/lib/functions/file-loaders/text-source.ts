/**
 * Shared source-text helpers for editable Markdown and TXT books.
 *
 * New imports retain their original source in `sourceText`. Older rows only
 * have rendered HTML, so the first edit uses the conservative conversion
 * below and shows a warning before the user saves it.
 */

import type {
  BooksDbBookData,
  Section
} from '$lib/data/database/books-db/versions/books-db';
import { getFormattedElementMd } from '$lib/functions/file-loaders/md/generate-md-html';
import { getFormattedElementTxt } from '$lib/functions/file-loaders/txt/generate-txt-html';

export type EditableTextFormat = 'markdown' | 'text';

export interface FormattedTextSource {
  elementHtml: string;
  characters: number;
  sections: Section[];
}

export function getEditableTextFormat(
  book: Pick<BooksDbBookData, 'originalFormat' | 'title'>
): EditableTextFormat | undefined {
  const raw = (book.originalFormat || book.title.split('.').pop() || '').toLowerCase();
  if (raw === 'md' || raw === 'markdown') return 'markdown';
  if (raw === 'txt') return 'text';
  return undefined;
}

export function formatTextSource(
  source: string,
  format: EditableTextFormat
): FormattedTextSource {
  const result =
    format === 'markdown' ? getFormattedElementMd(source) : getFormattedElementTxt(source);
  return {
    elementHtml: result.element.innerHTML,
    characters: result.characters,
    sections: result.sections
  };
}

export function recoverTextSource(elementHtml: string, format: EditableTextFormat): string {
  const doc = new DOMParser().parseFromString(`<main>${elementHtml}</main>`, 'text/html');
  const root = doc.querySelector('main');
  if (!root) return '';
  return format === 'markdown' ? recoverMarkdown(root) : recoverPlainText(root);
}

function recoverPlainText(root: Element): string {
  const lines: string[] = [];
  const sections = Array.from(root.children);
  const containers = sections.length ? sections : [root];

  for (const container of containers) {
    for (const child of Array.from(container.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag) || tag === 'p') {
        lines.push((child.textContent || '').trimEnd());
      } else if (tag === 'br') {
        lines.push('');
      } else {
        const text = (child.textContent || '').trimEnd();
        if (text) lines.push(text);
      }
    }
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function recoverMarkdown(root: Element): string {
  return renderBlockChildren(root).replace(/\n{3,}/g, '\n\n').trimEnd();
}

function renderBlockChildren(parent: Element): string {
  return Array.from(parent.childNodes).map(renderBlockNode).join('');
}

function renderBlockNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof Element)) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'div' || tag === 'main' || tag === 'section' || tag === 'article') {
    return renderBlockChildren(node);
  }
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag[1]))} ${renderInlineChildren(node).trim()}\n\n`;
  }
  if (tag === 'p') return `${renderInlineChildren(node).trimEnd()}\n\n`;
  if (tag === 'pre') {
    const code = node.querySelector('code');
    const language = Array.from(code?.classList || [])
      .find((name) => name.startsWith('language-'))
      ?.slice('language-'.length);
    return `\`\`\`${language || ''}\n${code?.textContent || node.textContent || ''}\n\`\`\`\n\n`;
  }
  if (tag === 'ul' || tag === 'ol') return `${renderList(node, 0)}\n`;
  if (tag === 'blockquote') {
    const body = renderBlockChildren(node).trim();
    return `${body.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  }
  if (tag === 'table') return renderTable(node);
  if (tag === 'hr') return '---\n\n';
  if (tag === 'br') return '\n';
  return `${renderInlineNode(node)}\n\n`;
}

function renderInlineChildren(parent: Element): string {
  return Array.from(parent.childNodes).map(renderInlineNode).join('');
}

function renderInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof Element)) return '';

  const tag = node.tagName.toLowerCase();
  const body = renderInlineChildren(node);
  if (tag === 'strong' || tag === 'b') return `**${body}**`;
  if (tag === 'em' || tag === 'i') return `*${body}*`;
  if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${body}~~`;
  if (tag === 'code') {
    const fence = body.includes('`') ? '``' : '`';
    return `${fence}${body}${fence}`;
  }
  if (tag === 'a') return `[${body || node.getAttribute('href') || ''}](${node.getAttribute('href') || ''})`;
  if (tag === 'img') {
    return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
  }
  if (tag === 'br') return '\n';
  return body;
}

function renderList(list: Element, depth: number): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  return items
    .map((item, index) => {
      let body = '';
      let nested = '';
      for (const child of Array.from(item.childNodes)) {
        if (child instanceof Element && /^(ul|ol)$/i.test(child.tagName)) {
          nested += renderList(child, depth + 1);
        } else {
          body += renderInlineNode(child);
        }
      }
      const indent = '  '.repeat(depth);
      const marker = ordered ? `${index + 1}.` : '-';
      return `${indent}${marker} ${body.trim()}\n${nested}`;
    })
    .join('');
}

function renderTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) =>
      renderInlineChildren(cell).trim().replace(/\|/g, '\\|')
    )
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill('')]);
  const output = [normalized[0], Array(width).fill('---'), ...normalized.slice(1)];
  return `${output.map((row) => `| ${row.join(' | ')} |`).join('\n')}\n\n`;
}
