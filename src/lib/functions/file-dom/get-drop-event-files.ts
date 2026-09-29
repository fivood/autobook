/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getEntryFiles } from './get-entry-files';

export async function getDropEventFiles(ev: DragEvent) {
  if (!ev.dataTransfer) {
    return [];
  }

  // Prefer the FileSystemEntry API so we can recurse into dropped folders.
  // In some environments (e.g., Tauri WebView) this API is incomplete; fall
  // back to the plain FileList so single-file drops still work.
  if (ev.dataTransfer.items) {
    const items = Array.from(ev.dataTransfer.items)
      .filter((i) => i.kind === 'file')
      .map((i) => i.webkitGetAsEntry())
      .filter((i): i is FileSystemEntry => !!i);

    if (items.length) {
      const nestedFiles = await Promise.all(items.map((i) => getEntryFiles(i)));
      return nestedFiles.flat();
    }
  }

  if (ev.dataTransfer.files) {
    return Array.from(ev.dataTransfer.files);
  }

  return [];
}
