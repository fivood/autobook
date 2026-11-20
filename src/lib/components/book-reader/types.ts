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
  /** Put the whole text back on screen. TTS calls this when it starts:
   * the two are mutually exclusive, and the reader has to be able to read
   * ahead and scroll while the voice runs. */
  revealAll: () => void;
  /** Where the reveal frontier currently sits, as a DOM position — what the
   * voice needs to start speaking the same sentence. */
  frontierPosition?: () => { node: Node; offset: number } | null;
  /** Type from this DOM position when the start now under way resolves it. */
  revealFromPositionLater?: (node: Node, offset: number) => void;
  /** Show everything and forget the frontier; the next start re-walks from
   * the screen. */
  markContentChanged?: () => void;
}

export interface AutoReader {
  wasReaderEnabled$: BehaviorSubject<boolean>;
  toggle: () => void;
  on: () => void;
  off: () => void;
  prepare: () => void;
  setContentEl: (el: HTMLElement | undefined) => void;
  /** `snapToSentenceStart` rewinds to the beginning of the sentence the count
   * lands inside, for handing playback over from the typewriter. */
  seekToExplored: (count: number, snapToSentenceStart?: boolean) => void;
  /** Seek to a position the reader's position calculator reports
   * (`exploredCharCount`, section-local), snapped to its sentence start. That
   * count strips punctuation and whitespace, so it is NOT a `seekToExplored`
   * index — see tts-calculator-index.ts. */
  seekToCalculatorIndex: (calcIndex: number) => void;
  setPosition: (para: number, offset: number) => void;
  /** Globally indexed character range of the sentence currently being
   * spoken — used by TtsHighlighter to paint a CSS Custom Highlight. */
  getCurrentSentence?: () => { globalStart: number; globalEnd: number; text: string } | null;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  /** Fatal-for-this-session failure the reader should be told about: the
   * engine has already called off() by the time this fires. */
  onError?: (message: string) => void;
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

  /** Advance to the next section's beginning. Returns false when at the last section. */
  advanceToNextSection?: () => boolean;

  /** If the (book-wide) char is past the currently visible page, flip pages
   * forward until it's visible. No-op in continuous mode. */
  ensureCharVisible?: (globalCharCount: number) => void;
}
