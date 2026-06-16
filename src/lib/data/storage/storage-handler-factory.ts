/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { InternalStorageSources, StorageKey } from '$lib/data/storage/storage-types';

import { BackupStorageHandler } from '$lib/data/storage/handler/backup-handler';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { TauriFsStorageHandler } from '$lib/data/storage/handler/tauri-fs-handler';
import { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

let backupStorageHandler: BackupStorageHandler;
let browserStorageHandler: BrowserStorageHandler;
let tauriFsStorageHandler: TauriFsStorageHandler;

export function getStorageHandler(
  window: Window,
  storageType: StorageKey.BACKUP,
  storageSourceName?: string,
  isForBrowser?: boolean,
  cacheStorageData?: boolean,
  saveBehavior?: ReplicationSaveBehavior,
  statisticsMergeMode?: MergeMode,
  readingGoalsMergeMode?: MergeMode,
  askForStorageUnlock?: boolean
): BackupStorageHandler;
export function getStorageHandler(
  window: Window,
  storageType: StorageKey.BROWSER,
  storageSourceName?: string,
  isForBrowser?: boolean,
  cacheStorageData?: boolean,
  saveBehavior?: ReplicationSaveBehavior,
  statisticsMergeMode?: MergeMode,
  readingGoalsMergeMode?: MergeMode,
  askForStorageUnlock?: boolean
): BrowserStorageHandler;
export function getStorageHandler(
  window: Window,
  storageType: StorageKey,
  storageSourceName?: string,
  isForBrowser?: boolean,
  cacheStorageData?: boolean,
  saveBehavior?: ReplicationSaveBehavior,
  statisticsMergeMode?: MergeMode,
  readingGoalsMergeMode?: MergeMode,
  askForStorageUnlock?: boolean
): BaseStorageHandler;
export function getStorageHandler(
  window: Window,
  storageType: StorageKey,
  storageSourceName = InternalStorageSources.INTERNAL_DEFAULT as string,
  isForBrowser = false,
  cacheStorageData = false,
  saveBehavior = ReplicationSaveBehavior.NewOnly,
  statisticsMergeMode = MergeMode.MERGE,
  readingGoalsMergeMode = MergeMode.MERGE,
  askForStorageUnlock = true
) {
  switch (storageType) {
    case StorageKey.BACKUP:
      backupStorageHandler =
        backupStorageHandler || new BackupStorageHandler(window, StorageKey.BACKUP);
      backupStorageHandler.updateSettings(
        window,
        isForBrowser,
        saveBehavior,
        statisticsMergeMode,
        readingGoalsMergeMode
      );

      return backupStorageHandler;
    case StorageKey.BROWSER:
      browserStorageHandler =
        browserStorageHandler || new BrowserStorageHandler(window, StorageKey.BROWSER);
      browserStorageHandler.updateSettings(
        window,
        true,
        saveBehavior,
        statisticsMergeMode,
        readingGoalsMergeMode
      );

      return browserStorageHandler;
    case StorageKey.TAURI_FS:
      tauriFsStorageHandler =
        tauriFsStorageHandler || new TauriFsStorageHandler(window, StorageKey.TAURI_FS);
      tauriFsStorageHandler.updateSettings(
        window,
        isForBrowser,
        saveBehavior,
        statisticsMergeMode,
        readingGoalsMergeMode,
        cacheStorageData,
        askForStorageUnlock,
        storageSourceName
      );

      return tauriFsStorageHandler;
    default:
      throw new Error(`No handler implementation for ${storageType}`);
  }
}
