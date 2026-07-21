/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface BookCardProps {
  id: number;
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
