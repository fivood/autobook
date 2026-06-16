/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { internalStorageSourceName } from '$lib/data/storage/storage-types';

import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
import StorageUnlock from '$lib/components/storage-unlock.svelte';
import { dialogManager } from '$lib/data/dialog-manager';
import { logger } from '$lib/data/logger';

const saltByteLength = 16;
const ivByteLength = 12;

async function generateKey(window: Window, salt: Uint8Array, secret: string) {
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256'
    },
    await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    ),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface FsHandle {
  directoryHandle: FileSystemDirectoryHandle;
  fsPath: string;
}

export interface RemoteContext {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

export interface StorageSourceSaveResult {
  new: BooksDbStorageSource;
  old?: string;
}

export interface StorageUnlockAction extends RemoteContext {
  secret?: string;
}

export function isAppDefault(name: string) {
  return internalStorageSourceName.has(name);
}

export function setStorageSourceDefault(_name: string, _type: any) {
  // no-op: cloud storage defaults removed
}

export async function encrypt(window: Window, payload: string, secret: string) {
  const allByteLength = saltByteLength + ivByteLength;
  const salt = window.crypto.getRandomValues(new Uint8Array(saltByteLength));
  const iv = window.crypto.getRandomValues(new Uint8Array(ivByteLength));
  const data = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    await generateKey(window, salt, secret),
    new TextEncoder().encode(payload)
  );
  const tempBuffer = new Uint8Array(data.byteLength + allByteLength);
  tempBuffer.set(new Uint8Array(salt), 0);
  tempBuffer.set(new Uint8Array(iv), salt.byteLength);
  tempBuffer.set(new Uint8Array(data), allByteLength);

  return tempBuffer.buffer;
}

export async function decrypt(window: Window, encryptedData: ArrayBuffer, secret: string) {
  const allByteLength = saltByteLength + ivByteLength;
  const salt = encryptedData.slice(0, saltByteLength);
  const iv = encryptedData.slice(saltByteLength, allByteLength);
  const data = encryptedData.slice(allByteLength);
  const key = await generateKey(window, new Uint8Array(salt), secret);

  return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
}

export async function unlockStorageData(
  storageSource: BooksDbStorageSource | undefined,
  unlockDescription: string,
  unlockProps?: Record<string, any>
) {
  let unlockResult: StorageUnlockAction | undefined;

  if (!unlockResult && unlockProps) {
    unlockResult = await new Promise<StorageUnlockAction | undefined>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: StorageUnlock,
          props: {
            ...unlockProps,
            description: unlockDescription,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });
  }

  return unlockResult;
}

export function isRemoteContext(
  data: FsHandle | ArrayBuffer | RemoteContext
): data is RemoteContext {
  return !!(data && 'clientId' in data && data.clientId);
}
