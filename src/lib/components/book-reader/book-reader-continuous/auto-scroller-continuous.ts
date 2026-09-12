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

  /** Where the voice stopped, waiting for the next start. See
   *  `revealFromPositionLater`. */
  private pendingReveal: { node: Node; offset: number } | null = null;

  /**
   * Paginated mode lays the whole section out in columns and shows one page at
   * a time. Hiding is `visibility`, so revealing never reflows and the page
   * boundaries stay put — measured on a real section: scrollWidth and
   * scrollHeight identical before and after wrapping a paragraph into 165
   * per-character spans, and the calculator's char indices unchanged at every
   * probe. What does change is what "keep up with the frontier" means:
   * scrolling is meaningless there, the answer is to turn the page.
   */
  paginated = false;

  /**
   * Bring the frontier back on screen. Left to the host in paginated mode
   * because turning the page needs the page manager and the calculator's own
   * character counting, neither of which belongs in here.
   */
  onFrontierRevealed?: (span: HTMLElement) => void;

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
          // After ensurePrepared, which on a first start reveals everything
          // already scrolled past and would otherwise overwrite the handover.
          this.consumePendingReveal();
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
    // The position pointed into DOM that is being replaced.
    this.pendingReveal = null;
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

  /**
   * Restart the reveal at the block holding `el` — the "start here" action's
   * typewriter half.
   *
   * Takes the element rather than a char offset on purpose: the blocks carry
   * element references, so matching one costs nothing, while a char offset
   * would have to be translated out of the selection's counting rules into
   * this one (see tts-calculator-index.ts for how that goes). Paragraph
   * granularity is all a reveal frontier can show anyway.
   */
  revealFrom(el: HTMLElement) {
    const block = this.blocks.find((b) => b.el === el || b.el.contains(el));
    if (!block) return;
    this.revealedIndex = block.start;
    this.applyReveal();
  }

  /**
   * Type from this DOM position the next time playback starts.
   *
   * Deferred rather than applied immediately: the voice hands it over when it
   * pauses, and TTS turning on already ran `revealAll()`, so applying it now
   * would re-hide the text the reader was left free to scroll through.
   */
  revealFromPositionLater(node: Node, offset: number) {
    this.pendingReveal = { node, offset };
  }

  private consumePendingReveal() {
    const pending = this.pendingReveal;
    this.pendingReveal = null;
    if (!pending) return;
    const index = this.charIndexOfPosition(pending.node, pending.offset);
    if (index == null) return;
    this.revealedIndex = index;
    this.applyReveal();
    this.followFrontierNow();
  }

  /**
   * Bring the frontier on screen right now.
   *
   * Only after a handover, never on a plain start: at a plain start the
   * frontier sits at the end of what the reader can already see, which
   * `blockIndexAt` resolves to the FIRST HIDDEN block — the next page. Following
   * that turned the page before a single character had been typed.
   */
  private followFrontierNow() {
    if (this.wrappedBlock < 0 || !this.wrappedChars.length) return;
    const local = this.revealedIndex - this.blocks[this.wrappedBlock].start;
    const clamped = Math.min(this.wrappedChars.length - 1, Math.max(0, local));
    this.keepFrontierVisible(this.wrappedChars[clamped]);
  }

  /**
   * Where the reveal frontier sits, as a DOM position — the voice's half of
   * the handover.
   *
   * A position, not this class's `revealedIndex`: that index counts block
   * `textContent`, which skips any text not inside a block element, while the
   * reader counts every text node. Handing over the number would mean
   * translating between the two counting rules, which is the mistake
   * `revealFrom` exists to avoid.
   */
  frontierPosition(): { node: Node; offset: number } | null {
    if (!this.blocks.length) return null;
    const block = this.blocks[this.blockIndexAt(this.revealedIndex)];
    if (!block) return null;
    const local = Math.max(0, this.revealedIndex - block.start);
    // While this block is wrapped every character sits in its own <span>, but
    // the text nodes still carry the same characters in the same order, so the
    // walk reads identically either way.
    const walker = this.doc.createTreeWalker(block.el, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let last: { node: Node; offset: number } | null = null;
    let node: Node | null = walker.nextNode();
    while (node) {
      const length = (node.textContent || '').length;
      if (length > 0) {
        if (local < seen + length) return { node, offset: local - seen };
        seen += length;
        last = { node, offset: length };
      }
      node = walker.nextNode();
    }
    // Frontier exactly at the block end — the end of its last text node.
    return last;
  }

  /** Inverse of `frontierPosition`, in this class's own character space. */
  private charIndexOfPosition(target: Node, offsetInNode: number): number | null {
    const element =
      target.nodeType === Node.TEXT_NODE ? target.parentElement : (target as HTMLElement);
    if (!element) return null;
    const blockIndex = this.blocks.findIndex((b) => b.el === element || b.el.contains(element));
    if (blockIndex < 0) return null;
    const block = this.blocks[blockIndex];
    const walker = this.doc.createTreeWalker(block.el, NodeFilter.SHOW_TEXT, null);
    let local = 0;
    let node: Node | null = walker.nextNode();
    while (node) {
      if (node === target) {
        return Math.min(block.start + local + offsetInNode, block.end);
      }
      local += (node.textContent || '').length;
      node = walker.nextNode();
    }
    // The position is inside the block but not on one of its text nodes (an
    // element anchor); the block start is the honest answer.
    return block.start;
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

    // What the reader has already been shown, and so keeps.
    //
    // Scrolling: everything above the fold — the frontier then continues down
    // the visible page.
    //
    // Paginated: everything BEFORE the current page, not including it. Taking
    // the current page too would leave the frontier exactly at the page
    // boundary, so the first character to type is on the next page and the
    // reader gets a page turn before a single character appears. Starting at
    // the top of the page they are looking at means they watch it type out.
    const behindFrontier = (rect: DOMRect) => {
      if (!this.paginated) return rect.top < (w.innerHeight || 0);
      return this.verticalMode ? rect.top < 0 : rect.left < 0;
    };

    let revealed = 0;
    for (const block of this.blocks) {
      if (behindFrontier(block.el.getBoundingClientRect())) revealed = block.end;
      else break;
    }
    this.revealedIndex = revealed;
    this.applyReveal();
  }

  /** Continuous mode's answer to a frontier that has walked off screen. */
  private scrollFrontierIntoView(span: HTMLElement) {
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

  private keepFrontierVisible(span: HTMLElement | undefined) {
    if (!span) return;
    if (this.onFrontierRevealed) this.onFrontierRevealed(span);
    else this.scrollFrontierIntoView(span);
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

      // Throttled so it doesn't jitter every frame — and in paginated mode so
      // the page-position lookup doesn't run per character.
      if (this.revealedIndex % 8 === 0) {
        this.keepFrontierVisible(this.wrappedChars[local]);
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
