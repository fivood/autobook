import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

const ROOT_DIR_NAME = 'AutoBook';
const STANDALONE_DIR_NAME = 'StandaloneNotes';

function sanitizeFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function slugFromText(text: string): string {
  const slug = text
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#`]/g, '')
    .slice(0, 40)
    .trim();
  return slug || 'note';
}

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function highlightFilename(h: BooksDbHighlight): string {
  const seed = h.kind === 'note' ? h.memo : h.text;
  return `${h.id}-${slugFromText(seed)}.md`;
}

function highlightFolderName(h: BooksDbHighlight): string {
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

function highlightToMarkdown(
  h: BooksDbHighlight,
  byId: Map<number, BooksDbHighlight>,
  folderName?: string
): string {
  const fmLines: string[] = ['---'];
  fmLines.push(`id: ${h.id}`);
  fmLines.push(`kind: ${h.kind === 'note' ? 'note' : 'highlight'}`);
  if (h.bookTitle) fmLines.push(`book: "${escapeYaml(h.bookTitle)}"`);
  if (folderName) fmLines.push(`folder: "${escapeYaml(folderName)}"`);
  fmLines.push(`color: ${h.color}`);
  fmLines.push(`created: ${new Date(h.createdAt).toISOString()}`);
  fmLines.push(`modified: ${new Date(h.lastModified).toISOString()}`);
  if (h.lastReviewedAt) {
    fmLines.push(`reviewed: ${new Date(h.lastReviewedAt).toISOString()}`);
  }
  if (h.tags && h.tags.length) {
    fmLines.push(`tags:`);
    for (const t of h.tags) fmLines.push(`  - ${t}`);
  }
  const linkRefs = buildLinkRefs(h.linkedIds, byId);
  if (linkRefs.length) {
    fmLines.push(`links:`);
    for (const r of linkRefs) fmLines.push(`  - "${escapeYaml(r)}"`);
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
  /** Highlight this file represents. Carried so the writer can spot the same
   * note under an older filename — the name embeds a slug of the text, so
   * editing a highlight's range renames its file and would otherwise leave
   * the previous one behind as an orphan. */
  id: number;
}

/**
 * Files under `dir` that belong to a note we just wrote under a *different*
 * name. Only same-id leftovers are reported: a file whose id is absent from
 * the plan belongs to a highlight that no longer exists locally, and deleting
 * those is a separate decision (this export has never mirrored deletions).
 */
export function staleVaultFiles(
  planned: VaultSyncFile[],
  existingNames: string[],
  dir: string
): string[] {
  const keepByDir = new Map<string, Map<number, string>>();
  for (const f of planned) {
    const slash = f.relativePath.lastIndexOf('/');
    const d = slash < 0 ? '' : f.relativePath.slice(0, slash);
    const name = f.relativePath.slice(slash + 1);
    if (!keepByDir.has(d)) keepByDir.set(d, new Map());
    keepByDir.get(d)!.set(f.id, name);
  }
  const keep = keepByDir.get(dir);
  if (!keep) return [];

  const stale: string[] = [];
  for (const name of existingNames) {
    const m = /^(\d+)-/.exec(name);
    if (!m) continue;
    const id = Number(m[1]);
    const current = keep.get(id);
    if (current && current !== name) stale.push(name);
  }
  return stale;
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
      id: h.id
    });
  }
  return { rootDirName: ROOT_DIR_NAME, files };
}
