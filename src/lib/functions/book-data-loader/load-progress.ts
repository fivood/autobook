/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Book-loading progress reporting. Replaces the pre-1.19.4 binary
 * `showSpinner` flag — surface concrete stages + percent so the user
 * sees which step is taking the time on big books.
 */

export type LoadStage =
  | 'idle'
  | 'db-fetch'
  | 'storage-pull'
  | 'blob-register'
  | 'format-parse'
  | 'format-clean'
  | 'stylesheet'
  | 'render'
  | 'done';

export interface LoadProgress {
  stage: LoadStage;
  /** 0..100. May go backwards when a new fetch starts (view mode toggle). */
  pct: number;
}

/** Translated where it is shown, not here. `labelKey:` is the sidecar shape
 * i18n-keys-test scans, so a key missing from zh fails the tests. */
export const STAGE_LABELS: Record<LoadStage, { labelKey: string }> = {
  idle: { labelKey: '' },
  'db-fetch': { labelKey: 'load.dbFetch' },
  'storage-pull': { labelKey: 'load.storagePull' },
  'blob-register': { labelKey: 'load.blobRegister' },
  'format-parse': { labelKey: 'load.formatParse' },
  'format-clean': { labelKey: 'load.formatClean' },
  stylesheet: { labelKey: 'load.stylesheet' },
  render: { labelKey: 'load.render' },
  done: { labelKey: 'load.done' }
};

export function progress(stage: LoadStage, pct: number): LoadProgress {
  return { stage, pct: Math.max(0, Math.min(100, Math.round(pct))) };
}
