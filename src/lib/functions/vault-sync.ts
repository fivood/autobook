/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * One-way sync from a folder of plain-text notes (an Obsidian vault, or a
 * subfolder of one) into the library. The files are authoritative: AutoBook
 * only ever reads them.
 *
 * Two deliberate choices worth knowing before changing anything here:
 *
 * - **Identity is the relative path, not the title.** A `.md` book's title is
 *   its filename, and a vault routinely holds several `index.md` /
 *   `README.md` in different folders, so titles collide. `sourcePath` does
 *   not.
 * - **Change detection compares content, not mtime.** The comparison is
 *   exact, which sidesteps clock skew, cloud-drive tools that touch mtime
 *   without editing, and files that get rewritten byte-identically. Notes are
 *   a few KB each, so reading them all is cheaper than one OCR page. If a
 *   vault ever gets big enough for that to hurt, mtime belongs in front of
 *   this as a fast path — not as a replacement.
 *
 * Move and rename are recovered by matching a vanished path against a new one
 * with identical content: `sourceText` already holds what the file said last
 * time, so this costs nothing extra. Renaming *and* editing between two scans
 * is the one case that can't be recovered; it degrades to remove + add, and
 * `removed` is reported separately so the caller can refuse to delete a book
 * that has reading progress.
 */

/** A note found on disk. `path` is relative to the sync root, POSIX-style. */
export interface VaultFile {
  path: string;
  content: string;
}

/** The subset of a book row this planner needs. */
export interface SyncedBook {
  id: number;
  sourcePath: string;
  sourceText?: string;
}

export interface VaultSyncPlan<B extends SyncedBook> {
  /** File content changed — re-render in place, keep progress. */
  changed: { book: B; content: string }[];
  /** Same content at a new path — just repoint and re-categorize. */
  moved: { book: B; path: string }[];
  /** No book claims this path — import it. */
  added: VaultFile[];
  /** Book's file is gone and nothing matched its content. */
  removed: B[];
}

/** Extensions treated as notes. Everything else in the vault is ignored —
 * attachments, PDFs and images are not what this feature is for. */
const NOTE_EXT = /\.(?:md|markdown|txt)$/i;

/** Directory names never descended into. */
const SKIP_DIR = new Set([
  '.obsidian',
  '.trash',
  '.git',
  // Notebook export writes here; scanning it would re-import AutoBook's own
  // notes as books.
  'AutoBook'
]);

/**
 * Read every note under `root`, recursively. Paths come back relative to the
 * root and POSIX-separated so they can be stored and compared verbatim.
 */
export async function readVaultFiles(root: string): Promise<VaultFile[]> {
  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
  const out: VaultFile[] = [];

  const walk = async (dir: string, prefix: string) => {
    const entries = await readDir(dir);
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(`${dir}/${entry.name}`, rel);
      } else if (entry.isFile && NOTE_EXT.test(entry.name)) {
        out.push({ path: rel, content: await readTextFile(`${dir}/${entry.name}`) });
      }
    }
  };

  await walk(root, '');
  return out;
}

/** Category for a note, from the folders above it. '' = sync root itself. */
export function categoryOfPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * Diff the files on disk against the books that claim to mirror them.
 *
 * Pure on purpose: all the IO lives in the caller, so the interesting part —
 * which is entirely about matching — can be tested without a filesystem.
 */
export function planVaultSync<B extends SyncedBook>(
  files: VaultFile[],
  books: B[]
): VaultSyncPlan<B> {
  const byPath = new Map(books.map((b) => [b.sourcePath, b]));
  const plan: VaultSyncPlan<B> = { changed: [], moved: [], added: [], removed: [] };
  const claimed = new Set<string>();
  const unmatchedFiles: VaultFile[] = [];

  for (const file of files) {
    const book = byPath.get(file.path);
    if (!book) {
      unmatchedFiles.push(file);
      continue;
    }
    claimed.add(file.path);
    if (book.sourceText !== file.content) {
      plan.changed.push({ book, content: file.content });
    }
  }

  // Books whose path produced no file this scan. Either moved, renamed, or
  // actually gone — the content match below decides which.
  const orphans = books.filter((b) => !claimed.has(b.sourcePath));

  // One book per content, so two notes that happen to hold identical text
  // can't both claim the same file. First writer wins; the loser falls
  // through to `added`/`removed`, which is the safe direction.
  const takenOrphans = new Set<B>();
  for (const file of unmatchedFiles) {
    const match = orphans.find(
      (b) => !takenOrphans.has(b) && b.sourceText !== undefined && b.sourceText === file.content
    );
    if (match) {
      takenOrphans.add(match);
      plan.moved.push({ book: match, path: file.path });
    } else {
      plan.added.push(file);
    }
  }
  plan.removed = orphans.filter((b) => !takenOrphans.has(b));

  return plan;
}
