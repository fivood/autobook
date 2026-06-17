/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const basePath = import.meta.env.VITE_BASE_PATH || 'https://reader.ttsu.app';
export const pagePath = import.meta.env.VITE_PAGE_PATH || '';
export const clearConsoleOnReload = !!import.meta.env.VITE_CLEAR_ON_RELOAD || false;
export const storageRootName = import.meta.env.VITE_STORAGE_ROOT_NAME || 'ttu-reader-data';

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    !!(window as any).isTauri
  );
}
