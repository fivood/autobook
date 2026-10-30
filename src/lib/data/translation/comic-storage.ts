import type { ComicStorage } from 'translator-workbench';
import { isTauri } from '$lib/data/env';
import { TauriComicStorage } from './comic-storage-tauri';

/**
 * Comic OCR needs the on-disk comic-cache (page images, OCR results, inpainted
 * layers). That cache lives under the Tauri filesystem, so the pipeline is
 * desktop-only today. Returning null lets callers surface a clear "use the
 * desktop app" message instead of crashing on a missing `invoke` in a plain
 * browser / dev-server tab.
 *
 * The Tauri fs plugin import above is inert in a browser — its `invoke` only
 * fires when a method is actually called — so this factory is safe to share.
 */
export function createComicStorage(): ComicStorage | null {
  return isTauri() ? new TauriComicStorage() : null;
}
