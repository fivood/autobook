/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Typewriter-style "auto-scroller": reveals book text character by character.
 * - multiplier semantics: characters per second
 * - already-scrolled content is revealed instantly on first start
 * - hidden text uses visibility:hidden so the layout never shifts
 *
 * ## Why this is block-incremental
 *
 * Continuous mode puts the *entire book* in the DOM at once. The original
 * implementation wrapped every character of it in its own <span> before the
 * first character could appear. Measured on a 300k-character novel that was
 * 218ms of JS plus 1063ms of layout — a 1.3 second freeze on pressing play —
 * and it left 303,000 extra elements resident, which every later resize and
 * scroll then had to carry.
 *
 * Almost all of that work was pointless: a paragraph the reader hasn't
 * arrived at yet doesn't need per-character control, it just needs to be
 * invisible. So blocks are hidden wholesale via a class, and only the single
 * block straddling the reveal frontier is wrapped per character. Blocks the
 * frontier has passed are unwrapped again, so the span count stays bounded by
 * one paragraph instead of growing with the book.
 */

import {
  BehaviorSubject,
  EMPTY,
  combineLatest,
  interval,
  switchMap,
  takeUntil,
  tap,
  type Observable
} from 'rxjs';
import type { AutoScroller } from '../types';
import {
  addPlaybackCharacters,
  setPlaybackMode
} from '$lib/components/book-reader/playback-progress';

const HIDDEN_CLASS = 'tw-hidden';
const BLOCK_HIDDEN_CLASS = 'tw-block-hidden';
const CHAR_CLASS = 'tw-c';

interface Block {
  el: HTMLElement;
  /** Global char offset of this block's first character. */
  start: number;
  /** Global char offset just past this block's last character. */
  end: number;
}

export class AutoScrollerContinuous implements AutoScroller {
  private enabled$ = new BehaviorSubject<boolean>(false);

  wasAutoScrollerEnabled$ = new BehaviorSubject<boolean>(false);

  private multiplierSubject: BehaviorSubject<number>;

  private blocks: Block[] = [];

  /** Total characters across all blocks. */
  private totalChars = 0;

  /** Characters revealed so far, as a global offset. */
  private revealedIndex = 0;

  /** Index into `blocks` of the block currently wrapped per character. */
  private wrappedBlock = -1;

  /** Per-character spans of `wrappedBlock`, in document order. */
  private wrappedChars: HTMLElement[] = [];

  private prepared = false;

  private contentEl: HTMLElement | undefined;

  constructor(
    initialMultiplier: number,
    public verticalMode: boolean,
    destroy$: Observable<void>,
    private doc: Document,
    contentEl?: HTMLElement
  ) {
    this.multiplierSubject = new BehaviorSubject<number>(initialMultiplier);
    if (contentEl) this.contentEl = contentEl;

    combineLatest([
      this.enabled$.pipe(
        tap((v) => {
          this.wasAutoScrollerEnabled$.next(v);
          setPlaybackMode(v ? 'typewriter' : 'manual');
        })
      ),
      this.multiplierSubject
    ])
      .pipe(
        switchMap(([enabled, mult]) => {
          if (!enabled) return EMPTY;
          this.ensurePrepared();
          const charsPerSec = Math.max(1, Math.min(60, mult));
          const delay = Math.max(16, Math.floor(1000 / charsPerSec));
          return interval(delay);
        }),
        takeUntil(destroy$)
      )
      .subscribe(() => this.revealNext());

    destroy$.subscribe(() => this.teardown());
  }

  get multiplier(): number {
    return this.multiplierSubject.getValue();
  }

  set multiplier(v: number) {
    this.multiplierSubject.next(v);
  }

  setContentEl(el: HTMLElement) {
    if (this.contentEl === el) return;
    this.contentEl = el;
    this.markContentChanged();
  }

  /** Force a re-walk on next start. Call this when book HTML is re-rendered. */
  markContentChanged() {
    this.teardown();
    this.prepared = false;
    this.blocks = [];
    this.totalChars = 0;
    this.revealedIndex = 0;
  }

  private ensurePrepared() {
    if (this.prepared) return;
    if (!this.contentEl) {
      console.warn('[typewriter] no contentEl yet');
      return;
    }
    this.indexBlocks();
    this.revealAlreadyScrolled();
    this.prepared = true;
  }

  /**
   * Build the block list and their character ranges. Only reads textContent
   * lengths — no DOM is created here, which is what keeps `prepare()` cheap
   * regardless of book size.
   */
  private indexBlocks() {
    if (!this.contentEl) return;

    // Leaf-ish block elements: containers that hold text but don't contain
    // another block. Falls back to the content root when the book's markup
    // has no block structure at all (bare text nodes).
    const candidates = Array.from(
      this.contentEl.querySelectorAll<HTMLElement>(
        'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, pre, figcaption, dd, dt'
      )
    ).filter((el) => !el.querySelector('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre'));

    const elements = candidates.length ? candidates : [this.contentEl];

    this.blocks = [];
    let offset = 0;
    for (const el of elements) {
      const length = (el.textContent || '').length;
      if (!length) continue;
      this.blocks.push({ el, start: offset, end: offset + length });
      offset += length;
    }
    this.totalChars = offset;
  }

  /** Locate the block covering a global char offset. */
  private blockIndexAt(globalIndex: number): number {
    let lo = 0;
    let hi = this.blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = this.blocks[mid];
      if (globalIndex < b.start) hi = mid - 1;
      else if (globalIndex >= b.end) lo = mid + 1;
      else return mid;
    }
    return Math.min(lo, this.blocks.length - 1);
  }

  /** Split a block's text nodes into one span per character. */
  private wrapBlock(index: number) {
    if (this.wrappedBlock === index) return;
    this.unwrapBlock();

    const block = this.blocks[index];
    if (!block) return;

    const walker = this.doc.createTreeWalker(block.el, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains(CHAR_CLASS)) return NodeFilter.FILTER_REJECT;
        return (node.textContent || '').length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const textNodes: Text[] = [];
    let cur: Node | null = walker.nextNode();
    while (cur) {
      textNodes.push(cur as Text);
      cur = walker.nextNode();
    }

    const chars: HTMLElement[] = [];
    for (const node of textNodes) {
      const text = node.textContent || '';
      if (!text) continue;
      const frag = this.doc.createDocumentFragment();
      for (const ch of text) {
        const span = this.doc.createElement('span');
        span.className = `${CHAR_CLASS} ${HIDDEN_CLASS}`;
        span.textContent = ch;
        chars.push(span);
        frag.appendChild(span);
      }
      node.parentNode?.replaceChild(frag, node);
    }

    this.wrappedBlock = index;
    this.wrappedChars = chars;
  }

  /** Collapse the per-character spans back into plain text nodes. */
  private unwrapBlock() {
    if (this.wrappedBlock < 0) return;
    const block = this.blocks[this.wrappedBlock];
    this.wrappedBlock = -1;
    this.wrappedChars = [];
    if (!block) return;

    const spans = Array.from(block.el.querySelectorAll<HTMLElement>(`.${CHAR_CLASS}`));
    for (const span of spans) {
      span.replaceWith(this.doc.createTextNode(span.textContent || ''));
    }
    // Merge the resulting run of single-char text nodes back into one, so
    // repeated wrap/unwrap cycles don't leave the tree progressively more
    // fragmented than it started.
    block.el.normalize();
  }

  /**
   * Apply `revealedIndex` to the DOM: everything before it visible,
   * everything after hidden, with the straddled block wrapped per character.
   */
  private applyReveal() {
    if (!this.blocks.length) return;

    const frontier = this.blocks.length ? this.blockIndexAt(this.revealedIndex) : -1;
    const atEnd = this.revealedIndex >= this.totalChars;
    const activeBlock = atEnd ? -1 : frontier;

    if (activeBlock !== this.wrappedBlock) {
      if (activeBlock >= 0) this.wrapBlock(activeBlock);
      else this.unwrapBlock();
    }

    for (let i = 0; i < this.blocks.length; i += 1) {
      const { el } = this.blocks[i];
      // The active block must stay visible as a whole — its characters carry
      // their own hidden state, and a block-level hide would mask them all.
      const hide = !atEnd && i > activeBlock;
      el.classList.toggle(BLOCK_HIDDEN_CLASS, hide);
    }

    if (activeBlock >= 0) {
      const localRevealed = this.revealedIndex - this.blocks[activeBlock].start;
      for (let i = 0; i < this.wrappedChars.length; i += 1) {
        this.wrappedChars[i].classList.toggle(HIDDEN_CLASS, i >= localRevealed);
      }
    }
  }

  /**
   * On the very first start, reveal everything above the current viewport so
   * the user keeps what they were already reading. Resolved block-by-block
   * (one getBoundingClientRect per paragraph) instead of per character.
   */
  private revealAlreadyScrolled() {
    if (!this.blocks.length) return;
    const w = this.doc.defaultView || window;
    const viewportBottom = (w.scrollY || 0) + (w.innerHeight || 0);

    let revealed = 0;
    for (const block of this.blocks) {
      const rect = block.el.getBoundingClientRect();
      const absTop = rect.top + (w.scrollY || 0);
      if (absTop < viewportBottom) revealed = block.end;
      else break;
    }
    this.revealedIndex = revealed;
    this.applyReveal();
  }

  private revealNext() {
    if (this.revealedIndex >= this.totalChars) {
      this.off();
      return;
    }
    this.revealedIndex += 1;

    const activeBlock = this.wrappedBlock;
    if (activeBlock >= 0 && this.revealedIndex >= this.blocks[activeBlock].end) {
      // Crossed into the next paragraph — re-resolve which block is active.
      this.applyReveal();
      return;
    }

    if (activeBlock >= 0) {
      const local = this.revealedIndex - this.blocks[activeBlock].start - 1;
      const revealed = this.wrappedChars[local];
      revealed?.classList.remove(HIDDEN_CLASS);
      // What the reader has actually been shown. The tracker cannot get this
      // from the scroll position — see playback-progress.ts.
      addPlaybackCharacters(revealed?.textContent || '');

      // Throttle scroll-into-view so it doesn't jitter every frame.
      if (this.revealedIndex % 8 === 0) {
        const span = this.wrappedChars[local];
        if (span) {
          const rect = span.getBoundingClientRect();
          const w = this.doc.defaultView || window;
          const vh = w.innerHeight || 0;
          // Keep the active line well above the bottom-right FAB stack
          // (pause / speed / keyboard-help take ~220px); scrolling sooner
          // means the typewriter caret never enters the occluded region.
          const safeBottom = Math.max(120, Math.floor(vh * 0.32));
          if (rect.bottom > vh - safeBottom) {
            span.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }
      }
      return;
    }

    this.applyReveal();
  }

  revealAll() {
    this.revealedIndex = this.totalChars;
    this.applyReveal();
  }

  /** Drop every DOM change this class made, leaving the book as it was. */
  private teardown() {
    this.unwrapBlock();
    for (const block of this.blocks) {
      block.el.classList.remove(BLOCK_HIDDEN_CLASS);
    }
  }

  toggle() {
    this.enabled$.next(!this.enabled$.getValue());
  }

  off() {
    this.enabled$.next(false);
  }
}
