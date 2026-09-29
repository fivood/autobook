/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { combineLatest, fromEvent, Observable, of, race, timer } from 'rxjs';
import { map, take } from 'rxjs/operators';

const IMAGE_LOAD_TIMEOUT_MS = 10000;

export function imageLoadingState(contentEl: HTMLElement) {
  const elements = Array.from(contentEl.getElementsByTagName('img'));
  return new Observable<boolean>((subscriber) => {
    // Images marked `loading="lazy"` (PDF/CBZ/CBR page images, see
    // optimizeBookPageImages) are loaded by the browser only when they enter
    // the viewport. Waiting on them here would hold `allowDisplay` false —
    // the full-screen white reader shell — until every off-screen page has
    // fired load, which on a 100+ page comic either stalls for the per-image
    // 10s timeout or never resolves in a real WebView2. The whole point of
    // lazy is "load on demand", so they must not gate first-paint.
    const obsArray = elements
      .filter((el) => el.src && el.loading !== 'lazy')
      .map(imageLoadComplete);

    if (obsArray.length <= 0) {
      subscriber.next(false);
      subscriber.complete();
      return undefined;
    }

    const subscription = combineLatest(obsArray).subscribe(() => {
      subscriber.next(false);
      subscriber.complete();
    });
    subscriber.next(true);

    return subscription;
  });
}

function imageLoadComplete(imgEl: HTMLImageElement) {
  if (imgEl.complete) {
    return of(1);
  }

  return race(
    fromEvent(imgEl, 'load'),
    fromEvent(imgEl, 'error'),
    timer(IMAGE_LOAD_TIMEOUT_MS).pipe(
      map(() => {
        console.warn('[imageLoadingState] image load timeout:', imgEl.src);
        return 1;
      })
    )
  ).pipe(take(1));
}
