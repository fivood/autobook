/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { skip } from 'rxjs';
import type { localStorage } from '../window/local-storage';
import { writableSubject } from '$lib/functions/svelte/store';

type Storage = typeof localStorage;

export function writableStorageSubject<T>(
  storage: Storage,
  // The key is passed along so a mapper that has to recover from a bad stored
  // value can name it — "object store is corrupt" is useless with 12 of them.
  mapFromString: (s: string, key: string) => T,
  mapToString: (t: T) => string
) {
  return (key: string, defaultValue: T) => {
    const initValue = getStoredOrDefault(storage)(key, defaultValue, mapFromString);
    const subject = writableSubject(initValue);
    subject.pipe(skip(1)).subscribe((updatedValue) => {
      storage.setItem(key, mapToString(updatedValue ?? defaultValue));
    });
    return subject;
  };
}

function getStoredOrDefault(storage: Storage) {
  return <T>(key: string, defaultVal: T, mapFn: (s: string, key: string) => T) => {
    const stored = storage.getItem(key);
    return stored ? mapFn(stored, key) : defaultVal;
  };
}
