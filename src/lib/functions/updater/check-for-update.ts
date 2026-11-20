/**
 * Tauri-only auto-updater glue.
 * Lazy-imports the updater plugin so the web build doesn't fail.
 */

import { writable } from 'svelte/store';
import { isTauri } from '$lib/data/env';

/**
 * The newer version a check found, kept after the dialog closes. Dismissing
 * the startup dialog with 稍后 used to be the last you saw of it until
 * 设置 → 数据 at the very bottom; NavStrip now keeps a way back to it.
 */
export const pendingUpdate$ = writable<UpdateInfo | null>(null);

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
  download: () => Promise<void>;
  install: () => Promise<void>;
  downloadAndInstall: (onProgress: (e: ProgressEvent) => void) => Promise<void>;
}

export interface ProgressEvent {
  event: 'Started' | 'Progress' | 'Finished';
  contentLength?: number;
  chunkLength?: number;
  downloaded: number;
  total: number;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;

  const { check } = await import('@tauri-apps/plugin-updater');
  // Without a timeout a stalled request never settles, and the manual check
  // — which answers every outcome with a dialog — showed nothing at all (Mac
  // test X9). Timing out turns that into the 检查更新失败 dialog.
  const update = await check({ timeout: 20_000 });
  if (!update) return null;

  let downloaded = 0;
  const total = 0;

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body || '',
    download: () => update.download(),
    install: () => update.install(),
    downloadAndInstall: async (onProgress) => {
      await update.downloadAndInstall((evt) => {
        if (evt.event === 'Started') {
          onProgress({
            event: 'Started',
            contentLength: evt.data.contentLength,
            downloaded: 0,
            total: evt.data.contentLength || 0
          });
        } else if (evt.event === 'Progress') {
          downloaded += evt.data.chunkLength;
          onProgress({
            event: 'Progress',
            chunkLength: evt.data.chunkLength,
            downloaded,
            total
          });
        } else {
          onProgress({ event: 'Finished', downloaded, total });
        }
      });
    }
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
