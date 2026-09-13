/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localStorage } from '$lib/data/window/local-storage';
import { writableStorageSubject } from '$lib/data/internal/writable-storage-subject';
import { parseOrDefault } from '$lib/data/internal/writable-object-local-storage-subject';

function createWritableObjectLocalStorageSubject<T>(fallback: string, storage = localStorage) {
  return writableStorageSubject(
    storage,
    // Same reasoning as the object subject: a corrupt value here is a white
    // window, because store.ts builds these at module scope.
    (x, key) => new Set(parseOrDefault<unknown[]>(x, fallback, key)) as T,
    (x) => JSON.stringify([...(x as Set<T>)])
  );
}

export function writableSetLocalStorageSubject<T>(storage = localStorage) {
  return createWritableObjectLocalStorageSubject<Set<T>>('[]', storage);
}
