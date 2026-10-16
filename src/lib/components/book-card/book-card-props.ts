/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardId } from '$lib/data/book-id';

export interface BookCardProps {
  /** Library-grid id. Equals the IDB `data.id` only under browser storage —
   * see book-id.ts. */
  id: BookCardId;
  imagePath: string | Blob;
  title: string;
  characters: number;
  lastBookModified: number;
  lastBookOpen: number;
  progress: number;
  lastBookmarkModified: number;
  isPlaceholder: boolean;
  /** Original file format from import time (epub/mobi/pdf/…). May be
   * undefined for books imported before 1.20.2 — the detail popover
   * falls back to detecting from the title's extension. */
  originalFormat?: string;
}
