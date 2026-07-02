/**
 * Screen Wake Lock helper. The typewriter use case is "phone on the table
 * while eating, watch the text reveal" — iOS Safari otherwise dims the
 * screen after ~30s of no touch and the experience falls apart.
 *
 * The API is supported on iOS 16.4+ Safari, all modern Android Chrome,
 * desktop Chrome / Edge / Firefox. Where it isn't (older Safari, in-app
 * webviews), we degrade silently — the worst case is what users get
 * today.
 *
 * Important behavior the caller doesn't have to think about:
 *
 *  - The browser **auto-releases** the sentinel when the page becomes
 *    hidden (tab switch, screen lock). When the page comes back, the
 *    sentinel is dead. We listen to `visibilitychange` and re-acquire
 *    if the caller was holding the lock at the time of hide.
 *
 *  - On iOS, `wakeLock.request('screen')` must be called from inside a
 *    user gesture handler the first time. We use it from the play
 *    button / tap-anywhere handler, which satisfies that — but a
 *    re-acquire after visibilitychange happens off-gesture and may
 *    silently fail. iOS seems to allow it in practice for a recently
 *    user-acquired sentinel; we just log and move on if it doesn't.
 */

type Sentinel = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
};

let sentinel: Sentinel | null = null;
let userWantsLock = false;

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export async function acquireWakeLock(): Promise<boolean> {
  userWantsLock = true;
  if (!isSupported()) return false;
  if (sentinel && !sentinel.released) return true;
  try {
    sentinel = (await (navigator as any).wakeLock.request('screen')) as Sentinel;
    sentinel.addEventListener('release', () => {
      // Browser released — usually because the page went hidden. We DON'T
      // flip userWantsLock so the visibilitychange handler can re-acquire.
      sentinel = null;
    });
    return true;
  } catch (err) {
    console.warn('[wake-lock] acquire failed', err);
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  userWantsLock = false;
  if (sentinel && !sentinel.released) {
    try {
      await sentinel.release();
    } catch {
      // ignore — already gone
    }
  }
  sentinel = null;
}

let wired = false;
/** Wire the visibilitychange → re-acquire flow. Idempotent. */
export function ensureVisibilityReacquire(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!userWantsLock) return;
    if (sentinel && !sentinel.released) return;
    // Best-effort re-acquire; if iOS rejects we just stay off.
    acquireWakeLock().catch(() => {});
  });
}

export function wakeLockSupported(): boolean {
  return isSupported();
}
