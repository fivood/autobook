/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Keeps the `--pdf-scale-factor` CSS variable on every `.pdf-page-shell`
 * in sync with the shell's actual rendered width. The shell carries
 * `data-page-w` (the page's intrinsic pixel width at scale 1); we divide
 * the live bounding-rect width by that, and the text layer's
 * `transform: scale(var(--pdf-scale-factor))` snaps to match the image.
 *
 * Used as a Svelte action on the reader's content container — call it on
 * the same element that owns the rendered book HTML and it'll observe any
 * `.pdf-page-shell` that ever lands inside, plus new ones added later.
 */

const SCALE_PROP = '--pdf-scale-factor';

function applyScale(shell: HTMLElement) {
  const intrinsic = Number(shell.dataset.pageW) || 0;
  if (!intrinsic) return;
  const actual = shell.getBoundingClientRect().width;
  if (!actual) return;
  shell.style.setProperty(SCALE_PROP, String(actual / intrinsic));
}

export function pdfPageShell(root: HTMLElement) {
  const observed = new WeakSet<HTMLElement>();
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      applyScale(entry.target as HTMLElement);
    }
  });

  function attach(shell: HTMLElement) {
    if (observed.has(shell)) return;
    observed.add(shell);
    ro.observe(shell);
    applyScale(shell);
  }

  function scan() {
    const shells = root.querySelectorAll<HTMLElement>('.pdf-page-shell');
    for (const shell of shells) attach(shell);
  }

  scan();

  // The reader rebuilds its DOM when the book / view-mode / blur changes;
  // pdf-page-shell elements show up after that swap, so we listen for new
  // children appearing under root.
  const mo = new MutationObserver(() => scan());
  mo.observe(root, { childList: true, subtree: true });

  return {
    destroy() {
      mo.disconnect();
      ro.disconnect();
    }
  };
}
