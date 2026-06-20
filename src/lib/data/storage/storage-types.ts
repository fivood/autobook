/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export enum StorageKey {
  BACKUP = 'backup',
  BROWSER = 'browser',
  TAURI_FS = 'tauri-fs'
}

export enum StorageDataType {
  DATA = 'data',
  PROGRESS = 'bookmark',
  STATISTICS = 'statistic',
  READING_GOALS = 'readingGoal',
  AUDIOBOOK = 'audioBook',
  SUBTITLE = 'subtitle',
  HIGHLIGHT = 'highlight'
}

export enum InternalStorageSources {
  INTERNAL_DEFAULT = 'ttu-internal-source',
  INTERNAL_BROWSER = 'ttu-internal-browser',
  INTERNAL_ZIP = 'ttu-internal-zip',
  INTERNAL_TAURI_FS = 'ttu-internal-tauri-fs'
}

export const internalStorageSourceName = new Set<string>([
  InternalStorageSources.INTERNAL_DEFAULT,
  InternalStorageSources.INTERNAL_BROWSER,
  InternalStorageSources.INTERNAL_ZIP,
  InternalStorageSources.INTERNAL_TAURI_FS
]);
