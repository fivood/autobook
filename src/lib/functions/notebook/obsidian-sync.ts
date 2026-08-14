import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

const ROOT_DIR_NAME = 'AutoBook';
const STANDALONE_DIR_NAME = 'StandaloneNotes';

/**
 * Book titles come from file metadata, so they are attacker-controlled as far
 * as this code is concerned. Beyond the usual illegal characters, a name made
 * only of dots has to go: `..` as a directory would put the write one level
 * above the vault's AutoBook folder. Windows also rejects trailing dots and a
 * handful of reserved device names.
 */
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFilename(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    // Trailing dots and spaces are silently dropped by Windows, which would
    // make two different titles collide on one file.
    .replace(/[. ]+$/, '')
    .trim();

  if (!cleaned || /^\.+$/.test(cleaned) || RESERVED_NAMES.test(cleaned)) return '_';
  // A leading dot would make the note hidden and, for `.`/`..`, navigate.
  return cleaned.startsWith('.') ? `_${cleaned.slice(1)}` : cleaned;
}

function slugFromText(text: string): string {
  const slug = text
    .replace(/\s+/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|#`\u0000-\u001f]/g, '')
    .slice(0, 40)
    .replace(/[. ]+$/, '')
    .trim();
  return slug || 'note';
}

/**
 * Emit a YAML double-quoted scalar. The hand-rolled escaping only covered
 * quotes and newlines, so a title containing a backslash produced an invalid
 * escape sequence and Obsidian failed to parse the whole frontmatter block.
 * JSON string syntax is a subset of YAML's double-quoted style, so this is
 * both correct and shorter.
 */
function yamlString(s: string): string {
  return JSON.stringify(String(s ?? ''));
}

export function highlightFilename(h: BooksDbHighlight): string {
  const seed = h.kind === 'note' ? h.memo : h.text;
  return `${h.id}-${slugFromText(seed)}.md`;
}

export function highlightFolderName(h: BooksDbHighlight): string {
  if (h.kind === 'note') return STANDALONE_DIR_NAME;
  return sanitizeFilename(h.bookTitle) || 'Untitled';
}

function buildLinkRefs(linkedIds: number[] | undefined, byId: Map<number, BooksDbHighlight>): string[] {
  if (!linkedIds) return [];
  return linkedIds
    .map((id) => byId.get(id))
    .filter((x): x is BooksDbHighlight => !!x)
    .map((other) => `${highlightFolderName(other)}/${highlightFilename(other).replace(/\.md$/, '')}`);
}

export function highlightToMarkdown(
  h: BooksDbHighlight,
  byId: Map<number, BooksDbHighlight>,
  folderName?: string
): string {
  const fmLines: string[] = ['---'];
  fmLines.push(`id: ${h.id}`);
  fmLines.push(`kind: ${h.kind === 'note' ? 'note' : 'highlight'}`);
  if (h.bookTitle) fmLines.push(`book: ${yamlString(h.bookTitle)}`);
  if (folderName) fmLines.push(`folder: ${yamlString(folderName)}`);
  fmLines.push(`color: ${h.color}`);
  fmLines.push(`created: ${new Date(h.createdAt).toISOString()}`);
  fmLines.push(`modified: ${new Date(h.lastModified).toISOString()}`);
  if (h.lastReviewedAt) {
    fmLines.push(`reviewed: ${new Date(h.lastReviewedAt).toISOString()}`);
  }
  if (h.tags && h.tags.length) {
    fmLines.push(`tags:`);
    for (const t of h.tags) fmLines.push(`  - ${yamlString(t)}`);
  }
  const linkRefs = buildLinkRefs(h.linkedIds, byId);
  if (linkRefs.length) {
    fmLines.push(`links:`);
    for (const r of linkRefs) fmLines.push(`  - ${yamlString(r)}`);
  }
  fmLines.push('---', '');

  const body: string[] = [];
  if (h.kind === 'note') {
    body.push(h.memo);
  } else {
    for (const para of h.text.split(/\n+/)) {
      body.push(`> ${para}`);
    }
    if (h.memo) {
      body.push('', `**备注：** ${h.memo}`);
    }
  }
  if (linkRefs.length) {
    body.push('', '## 关联');
    for (const r of linkRefs) {
      body.push(`- [[${r.split('/').pop()}]]`);
    }
  }
  return fmLines.join('\n') + body.join('\n') + '\n';
}

export interface VaultSyncFile {
  relativePath: string;
  content: string;
  /** When the note last changed, so a sync can skip files already up to date. */
  lastModified: number;
}

export interface VaultSyncPlan {
  rootDirName: string;
  files: VaultSyncFile[];
}

export function buildSyncPlan(
  highlights: BooksDbHighlight[],
  folderNameById: Map<number, string>
): VaultSyncPlan {
  const byId = new Map(highlights.map((h) => [h.id, h]));
  const files: VaultSyncFile[] = [];
  for (const h of highlights) {
    const folderName = h.folderId !== undefined ? folderNameById.get(h.folderId) : undefined;
    const dir = highlightFolderName(h);
    const file = highlightFilename(h);
    files.push({
      relativePath: `${dir}/${file}`,
      content: highlightToMarkdown(h, byId, folderName),
      lastModified: h.lastModified || h.createdAt || 0
    });
  }
  return { rootDirName: ROOT_DIR_NAME, files };
}
