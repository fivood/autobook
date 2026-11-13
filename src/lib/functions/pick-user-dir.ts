/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isTauri } from '$lib/data/env';

/**
 * Pick a folder the app keeps access to across restarts.
 *
 * Deliberately not `plugin-dialog`'s `open({ directory: true })`. That does
 * grant the pick to the fs scope, but only for the life of the process — and
 * now that the blanket `**` scope is gone, a vault or library root chosen
 * today would come back unreadable after the next launch. The Rust
 * `pick_user_dir` command opens the same native dialog and then grants *and*
 * remembers the choice, so the two can't drift apart.
 *
 * Returns null when the user cancels, or outside Tauri where there is no
 * native picker to open.
 */
export async function pickUserDir(
  options: { title?: string; defaultPath?: string } = {}
): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const picked = await invoke<string | null>('pick_user_dir', {
    title: options.title ?? null,
    defaultPath: options.defaultPath ?? null
  });
  return picked ?? null;
}
