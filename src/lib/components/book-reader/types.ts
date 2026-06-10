/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BehaviorSubject } from 'rxjs';
import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';

export interface AutoScroller {
  wasAutoScrollerEnabled$: BehaviorSubject<boolean>;
  multiplier: number;
  toggle: () => void;
  off: () => void;
  revealAll: () => void;
}

export interface AutoReader {
  wasReaderEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  off: () => void;
  prepare: () => void;
  seekToExplored: (count: number) => void;
  getPosition: () => { para: number; offset: number };
  setPosition: (para: number, offset: number) => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  rate: number;
  voice: SpeechSynthesisVoice | undefined;
  lang: string;
  autoSelectVoice: () => void;
}

export interface BookmarkManager {
  formatBookmarkData: (
    bookId: number,
    customReadingPointScrollOffset: number
  ) => BooksDbBookmarkData;

  formatBookmarkDataByRange: (
    bookId: number,
    customReadingPointRange: Range | undefined
  ) => BooksDbBookmarkData;

  scrollToBookmark: (
    bookmarkData: BooksDbBookmarkData,
    customReadingPointScrollOffset?: number
  ) => void;
}

export interface PageManager {
  nextPage: () => void;

  prevPage: () => void;

  updateSectionDataByOffset: (offset: number) => void;
}
