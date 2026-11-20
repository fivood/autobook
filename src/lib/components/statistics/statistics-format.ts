/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Shared number formatting for the statistics panels. The daily summary and
 * the year view have to agree on what "2h13m" and "1.2万" look like, and they
 * only agree if it is one function.
 */

export function formatDuration(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h}h${m}m` : `${h}h`;
  }
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec)}s`;
}

export function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return `${n}`;
}
