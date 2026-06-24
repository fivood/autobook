// Minimal Markdown → plaintext converter for the typewriter view. We don't
// render headings/lists/blockquotes visually — the typewriter just reveals
// chars — so we strip the syntax but preserve text, and convert leading `#`
// blocks into chapter-heading lines that parse-text.ts will pick up.

import { extractTxt } from './extract-txt';

export async function loadMd(file: File): Promise<string> {
  const raw = await extractTxt(file);
  return mdToPlainText(raw);
}

export function mdToPlainText(md: string): string {
  // Strip YAML frontmatter at file start (---\n...\n---). Common in
  // Obsidian / Jekyll / Hugo notes; would otherwise read as garbage.
  let body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
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
  // Headings → keep the text as a standalone line so parse-text.ts treats
  // `# 第一章 X` like a regular chapter heading. `##+` becomes a chapter
  // marker too (most md books use ## for chapters and # for the book title).
  body = body.replace(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm, '$2');
  return body;
}
