import { dialogManager } from '$lib/data/dialog-manager';
import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
import { isTauri } from '$lib/data/env';
import { tImmediate } from '$lib/i18n';

/** Wipe Local Storage and reload. On desktop, ask Rust to schedule it so the
 *  wipe works even when stale UI state would block the page. */
async function performUiReset(): Promise<void> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('schedule_ui_reset');
      return;
    } catch (err) {
      console.warn('[ui-reset] schedule failed, falling back to in-page clear:', err);
    }
  }
  // Browser fallback / desktop degraded path
  const toClear: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) toClear.push(k);
  }
  toClear.forEach((k) => localStorage.removeItem(k));
  window.location.reload();
}

/** Confirm-then-reset. `onConfirm` runs after the user confirms but before the
 *  reset begins (e.g. flip a "resetting" UI flag for feedback). */
export function confirmResetUiSettings(onConfirm?: () => void): void {
  dialogManager.dialogs$.next([
    {
      component: ConfirmDialog,
      props: {
        dialogHeader: tImmediate('settings.resetUi.title'),
        dialogMessage: tImmediate('settings.resetUi.confirm'),
        contentStyles: 'white-space: pre-line;',
        resolver: async (wasCanceled: boolean) => {
          if (wasCanceled) return;
          onConfirm?.();
          await performUiReset();
        }
      }
    }
  ]);
}
