// Keeps `--pdf-scale-factor` on each `.pdf-page-shell` in sync with the
// shell's actual rendered width. The shell carries `data-page-w` (the
// page's intrinsic px width at scale 1); we divide the live
// bounding-rect width by that, and the text layer's
// `transform: scale(var(--pdf-scale-factor))` snaps to match the image.
//
// Mirror of `autopage/src/lib/functions/pdf-page-shell.ts` — same math,
// kept independent so the mobile PWA doesn't pull anything from the
// desktop tree.

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

  // PDF pages are appended lazily as the user scrolls (Svelte's #each
  // re-render), so watch for new children landing inside `root`.
  const mo = new MutationObserver(() => scan());
  mo.observe(root, { childList: true, subtree: true });

  return {
    destroy() {
      mo.disconnect();
      ro.disconnect();
    }
  };
}
