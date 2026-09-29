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
  /** Human-readable one-liner (Chinese, matches app tone). */
  label: string;
}

export const STAGE_LABELS: Record<LoadStage, string> = {
  idle: '',
  'db-fetch': '读取书数据…',
  'storage-pull': '从存储拉取…',
  'blob-register': '注册图片…',
  'format-parse': '解析 HTML…',
  'format-clean': '清理 & 图片布局…',
  stylesheet: '样式表…',
  render: '渲染首屏…',
  done: '完成'
};

export function progress(stage: LoadStage, pct: number): LoadProgress {
  return { stage, pct: Math.max(0, Math.min(100, Math.round(pct))), label: STAGE_LABELS[stage] };
}
