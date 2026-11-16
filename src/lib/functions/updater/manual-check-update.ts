/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import MessageDialog from '$lib/components/message-dialog.svelte';
import UpdateDialog from '$lib/components/updater/update-dialog.svelte';
import { dialogManager } from '$lib/data/dialog-manager';
import { checkForUpdate, pendingUpdate$, type UpdateInfo } from '$lib/functions/updater/check-for-update';
import { tImmediate } from '$lib/i18n';
import { get, writable } from 'svelte/store';

/** Shared so the 关于 tab and the 更新记录 page show one check in flight. */
export const checkingUpdate$ = writable(false);

/**
 * The update check someone asked for by hand. Unlike the silent startup
 * check, every outcome gets an answer — including "already up to date" and a
 * failure — because the person is waiting for one.
 */
export async function manualCheckUpdate() {
  if (get(checkingUpdate$)) return;
  checkingUpdate$.set(true);
  let update: UpdateInfo | null = null;
  try {
    update = await checkForUpdate();
  } catch (err: any) {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: { title: tImmediate('update.checkFailed'), message: err?.message ?? String(err) }
      }
    ]);
    return;
  } finally {
    checkingUpdate$.set(false);
  }
  pendingUpdate$.set(update);
  if (update) {
    dialogManager.dialogs$.next([{ component: UpdateDialog, props: { update } }]);
  } else {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: tImmediate('update.upToDate.title'),
          message: tImmediate('update.upToDate.body')
        }
      }
    ]);
  }
}
