/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * One-time migration for folders the user picked before the fs scope was
 * narrowed.
 *
 * Until 1.28.x the app shipped a `**` fs scope, so a library root, Obsidian
 * vault or dictionary folder anywhere on disk just worked. The scope is now
 * `Documents/AutoBook` plus whatever `pick_user_dir` has remembered — and
 * paths chosen before that command existed were never remembered. Left alone
 * they fail silently: the setting still shows the old path, sync just stops
 * writing.
 *
 * So on startup each configured path is probed, and anything the scope now
 * refuses is surfaced for the user to re-pick once.
 */

import { isTauri } from '$lib/data/env';
import { dictFolderPath$, fsRoot$, obsidianVaultPath$ } from '$lib/data/store';

export type ReauthId = 'library' | 'vault' | 'dict';

export interface ReauthTarget {
  id: ReauthId;
  path: string;
  /** i18n key naming what this folder is for. */
  labelKey: string;
}

const TARGETS: { id: ReauthId; labelKey: string; read: () => string }[] = [
  { id: 'library', labelKey: 'fsReauth.library', read: () => fsRoot$.getValue().trim() },
  { id: 'vault', labelKey: 'fsReauth.vault', read: () => obsidianVaultPath$.getValue().trim() },
  { id: 'dict', labelKey: 'fsReauth.dict', read: () => dictFolderPath$.getValue().trim() }
];

/**
 * A scope denial and a deleted folder look different on purpose: a path
 * outside the scope makes the plugin *throw*, while a granted-but-missing
 * folder resolves to `false`. Only the throw means "needs re-authorizing" —
 * treating a missing folder the same way would nag people whose external
 * drive is merely unplugged.
 */
async function isReachable(path: string): Promise<boolean> {
  const { exists } = await import('@tauri-apps/plugin-fs');
  try {
    await exists(path);
    return true;
  } catch {
    return false;
  }
}

/** Configured folders the fs scope no longer allows. Empty outside Tauri. */
export async function findUnreachableUserDirs(): Promise<ReauthTarget[]> {
  if (!isTauri()) return [];

  const found: ReauthTarget[] = [];
  for (const target of TARGETS) {
    const path = target.read();
    if (!path) continue;
    // Sequential on purpose: three cheap probes, and running them in parallel
    // would race three plugin imports on a cold start for no real gain.
    if (!(await isReachable(path))) {
      found.push({ id: target.id, path, labelKey: target.labelKey });
    }
  }
  return found;
}

/** Persist a freshly re-picked folder to whichever setting it belongs to. */
export function applyReauthorizedPath(id: ReauthId, path: string) {
  if (id === 'library') fsRoot$.next(path);
  else if (id === 'vault') obsidianVaultPath$.next(path);
  else dictFolderPath$.next(path);
}
