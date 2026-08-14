/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * The app's static fs scope only covers `Documents/AutoBook`. Directories the
 * user picks themselves (Obsidian vault, dictionary folder) are granted at
 * runtime through this helper, so a page that gets compromised by a malicious
 * book can't reach arbitrary paths without the user having chosen them.
 */

import { isTauri } from '$lib/data/env';

const granted = new Set<string>();

/**
 * Grant read/write access to a user-picked directory for the rest of the
 * session. Idempotent; a no-op outside Tauri. Errors are surfaced to the
 * caller so a failed grant doesn't look like a missing folder later.
 */
export async function grantDirAccess(path: string): Promise<void> {
  if (!isTauri() || !path || granted.has(path)) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('allow_user_dir', { path });
  granted.add(path);
}
