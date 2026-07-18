/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Slim stub. The named-storage-sources UI was removed in the storage
 * unification pass; only these two shape types are still referenced by
 * historical IndexedDB migrations (v4/v5/v6) which cannot be edited.
 */

export interface FsHandle {
  directoryHandle: FileSystemDirectoryHandle;
  fsPath: string;
}

export interface RemoteContext {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}
