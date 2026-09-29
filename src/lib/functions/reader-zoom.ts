/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Ctrl + wheel / Ctrl + `=` `-` `0` zoom for the reader, the way a browser
 * does it.
 *
 * Not WebView2's own zoom: `zoomHotkeysEnabled` defaults to false and
 * tauri.conf.json never turns it on, and turning it on would be the wrong tool
 * anyway — it scales the whole UI (toolbar, FABs, settings drawer), keeps the
 * level outside our stores, and forgets it when the window closes. So zoom is
 * applied to the content: font size for text, `--book-image-scale` for PDF /
 * CBZ pages. Both already persist per user.
 *
 * Which of the two a wheel tick hits is decided per event by the `imageMode`
 * callback rather than captured once — the reader swaps between text and image
 * books without this module being re-attached.
 */

import { fontSize$, skipKeyDownListener$, FONT_SIZE_DEFAULT } from '$lib/data/store';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';

/** Image zoom level for PDF / CBZ pages. Lives here rather than inside
 *  book-image-zoom.svelte because the keyboard/wheel handler needs it too, and
 *  that component only mounts for image books. Key unchanged, so users keep
 *  the level they already had. */
export const bookImageScale$ = writableNumberLocalStorageSubject()('bookImageScale', 1);

export const IMAGE_ZOOM_STEPS = [0.5, 0.66, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The settings input accepts anything from 1px up; the wheel does not, because
 *  a stray Ctrl+scroll should not be able to make the book unreadable in either
 *  direction with no visible control to undo it. */
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 72;

function nearestStepIdx(v: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < IMAGE_ZOOM_STEPS.length; i += 1) {
    const d = Math.abs(IMAGE_ZOOM_STEPS[i] - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 10% per notch like a browser, but never less than 1px — plain rounding
 *  stalls at small sizes (9 * 1.1 rounds back to 9). */
export function nextFontSize(current: number, delta: number) {
  const scaled = delta > 0 ? current * 1.1 : current / 1.1;
  const next =
    delta > 0 ? Math.max(current + 1, Math.round(scaled)) : Math.min(current - 1, Math.round(scaled));
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, next));
}

export function nextImageScale(current: number, delta: number) {
  const i = nearestStepIdx(current);
  return IMAGE_ZOOM_STEPS[Math.max(0, Math.min(IMAGE_ZOOM_STEPS.length - 1, i + delta))];
}

export function stepImageZoom(delta: number) {
  bookImageScale$.next(nextImageScale(bookImageScale$.getValue() || 1, delta));
}

export function resetImageZoom() {
  bookImageScale$.next(1);
}

/** True while the event came from somewhere the user is typing — Ctrl+`-` in a
 *  note editor or the settings font field must stay a text edit. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/**
 * Wire the zoom gestures. Returns the teardown.
 *
 * The wheel listener sits on `window` with `passive: false` so it can cancel
 * the event; the paginated reader's own wheel subscription ignores Ctrl now, so
 * a zoom tick no longer flips a page on the way past.
 */
export function attachReaderZoom(imageMode: () => boolean) {
  const apply = (delta: number) => {
    if (imageMode()) stepImageZoom(delta);
    else fontSize$.next(nextFontSize(fontSize$.getValue(), delta));
  };
  const reset = () => {
    if (imageMode()) resetImageZoom();
    else fontSize$.next(FONT_SIZE_DEFAULT);
  };

  const onWheel = (ev: WheelEvent) => {
    if (!ev.ctrlKey || !ev.deltaY || skipKeyDownListener$.getValue()) return;
    ev.preventDefault();
    apply(ev.deltaY < 0 ? 1 : -1);
  };

  const onKeydown = (ev: KeyboardEvent) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    if (skipKeyDownListener$.getValue() || isTyping(ev.target)) return;
    // `=` and `+` share a key, and the numpad reports `Add` / `Subtract`.
    const delta =
      ev.key === '=' || ev.key === '+' ? 1 : ev.key === '-' || ev.key === '_' ? -1 : 0;
    if (delta) {
      ev.preventDefault();
      apply(delta);
    } else if (ev.key === '0') {
      ev.preventDefault();
      reset();
    }
  };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeydown);
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeydown);
  };
}
