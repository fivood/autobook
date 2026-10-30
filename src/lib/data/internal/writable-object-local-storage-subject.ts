/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localStorage } from '$lib/data/window/local-storage';
import { writableStorageSubject } from '$lib/data/internal/writable-storage-subject';

/**
 * A stored value that no longer parses must NOT take the app down with it.
 *
 * Every one of these subjects is constructed at module scope in `store.ts`, so
 * a throw here happens during module evaluation — before any component mounts,
 * before SvelteKit's error boundary exists. The result is a white window with
 * no way back except the tray's "重置 UI", i.e. the user loses every setting to
 * fix one bad key. Truncated values are not hypothetical: these subjects hold
 * the big free-text blobs (custom themes, TTS preset JSON, user fonts), and a
 * write interrupted by power loss or a full disk leaves exactly this.
 *
 * The bad string is deliberately left in storage rather than deleted — the next
 * write overwrites it anyway, and keeping it means a user who cares can still
 * recover what they typed by hand.
 */
function parseOrDefault<T>(raw: string, fallback: string, key: string): T {
  try {
    return JSON.parse(raw || fallback) as T;
  } catch (err) {
    console.warn(`[storage] ${key} is corrupt, falling back to default:`, err);
    return JSON.parse(fallback) as T;
  }
}

function createWritableObjectLocalStorageSubject<T>(fallback: string, storage = localStorage) {
  return writableStorageSubject(
    storage,
    (x, key) => parseOrDefault<T>(x, fallback, key),
    (x) => JSON.stringify(x)
  );
}

export function writableObjectLocalStorageSubject<T>(storage = localStorage) {
  return createWritableObjectLocalStorageSubject<T>('{}', storage);
}

export function writableArrayLocalStorageSubject<T>(storage = localStorage) {
  return createWritableObjectLocalStorageSubject<T[]>('[]', storage);
}

export { parseOrDefault };
