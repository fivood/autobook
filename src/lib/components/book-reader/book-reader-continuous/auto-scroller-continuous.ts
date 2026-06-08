/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Typewriter-style "auto-scroller": reveals book text character by character.
 * - multiplier semantics: characters per second
 * - already-scrolled content is revealed instantly on first start
 * - hidden chars use visibility:hidden so the layout doesn't shift
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

const HIDDEN_CLASS = 'tw-hidden';

export class AutoScrollerContinuous implements AutoScroller {
  private enabled$ = new BehaviorSubject<boolean>(false);

  wasAutoScrollerEnabled$ = new BehaviorSubject<boolean>(false);

  private multiplierSubject: BehaviorSubject<number>;

  private chars: HTMLElement[] = [];

  private revealedIndex = 0;

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
      this.enabled$.pipe(tap((v) => this.wasAutoScrollerEnabled$.next(v))),
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
    this.prepared = false;
    this.chars = [];
    this.revealedIndex = 0;
  }

  private ensurePrepared() {
    if (this.prepared) return;
    if (!this.contentEl) {
      // eslint-disable-next-line no-console
      console.warn('[typewriter] no contentEl yet');
      return;
    }
    this.prepareChars();
    // eslint-disable-next-line no-console
    console.info(`[typewriter] prepared ${this.chars.length} chars`);
    this.revealAlreadyScrolled();
    this.prepared = true;
  }

  private prepareChars() {
    if (!this.contentEl) return;

    const walker = this.doc.createTreeWalker(this.contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains('tw-c')) return NodeFilter.FILTER_REJECT;
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

    for (let i = 0; i < textNodes.length; i += 1) {
      const node = textNodes[i];
      const text = node.textContent || '';
      if (!text) continue;
      const frag = this.doc.createDocumentFragment();
      // eslint-disable-next-line no-restricted-syntax
      for (const ch of text) {
        if (ch === '\n' || ch === '\r' || ch === '\t') {
          frag.appendChild(this.doc.createTextNode(ch));
          continue;
        }
        const span = this.doc.createElement('span');
        span.className = `tw-c ${HIDDEN_CLASS}`;
        span.textContent = ch;
        this.chars.push(span);
        frag.appendChild(span);
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }

  /**
   * On the very first start, reveal everything above the current viewport
   * so the user keeps what they were already reading.
   */
  private revealAlreadyScrolled() {
    if (!this.chars.length) return;
    const w = this.doc.defaultView || window;
    const viewportBottom = (w.scrollY || 0) + (w.innerHeight || 0);

    for (let i = 0; i < this.chars.length; i += 1) {
      const span = this.chars[i];
      const rect = span.getBoundingClientRect();
      const absTop = rect.top + (w.scrollY || 0);
      if (absTop < viewportBottom) {
        span.classList.remove(HIDDEN_CLASS);
        this.revealedIndex = i + 1;
      } else {
        break;
      }
    }
  }

  private revealNext() {
    if (this.revealedIndex >= this.chars.length) {
      this.off();
      return;
    }
    const span = this.chars[this.revealedIndex];
    span.classList.remove(HIDDEN_CLASS);
    this.revealedIndex += 1;

    // Throttle scroll-into-view so it doesn't jitter every frame.
    if (this.revealedIndex % 8 === 0) {
      const rect = span.getBoundingClientRect();
      const w = this.doc.defaultView || window;
      const vh = w.innerHeight || 0;
      if (rect.bottom > vh - 80) {
        span.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    }
  }

  seekToCharIndex(index: number) {
    if (!this.chars.length) return;
    const target = Math.max(0, Math.min(index, this.chars.length));
    for (let i = this.revealedIndex; i < target; i += 1) {
      this.chars[i].classList.remove(HIDDEN_CLASS);
    }
    this.revealedIndex = target;
  }

  toggle() {
    this.enabled$.next(!this.enabled$.getValue());
  }

  off() {
    this.enabled$.next(false);
  }
}
