/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

/**
 * Keep a `position: fixed` menu inside the window, re-checking whenever the
 * menu itself changes size.
 *
 * Callers used to clamp the click point against a guessed menu size. That
 * breaks as soon as the menu's height depends on its content — the library's
 * right-click menu had one row per category and ran off the bottom of the
 * window near the lower edge, taking 删除 with it. Measuring the real box
 * doesn't have to guess.
 *
 * Applied as a `translate`, so the caller's own left/top (set from the click
 * point, often reactively) is never overwritten.
 */
export function keepInViewport(node: HTMLElement, margin = 8) {
  const fit = () => {
    node.style.translate = '';
    const rect = node.getBoundingClientRect();
    const overRight = rect.right - (window.innerWidth - margin);
    const overBottom = rect.bottom - (window.innerHeight - margin);
    const dx = overRight > 0 ? -Math.min(overRight, rect.left - margin) : 0;
    const dy = overBottom > 0 ? -Math.min(overBottom, rect.top - margin) : 0;
    if (dx || dy) node.style.translate = `${dx}px ${dy}px`;
  };

  const observer = new ResizeObserver(fit);
  observer.observe(node);
  window.addEventListener('resize', fit);
  fit();

  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    }
  };
}
