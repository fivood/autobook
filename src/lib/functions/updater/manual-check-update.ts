/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import MessageDialog from '$lib/components/message-dialog.svelte';
import UpdateDialog from '$lib/components/updater/update-dialog.svelte';
import { dialogManager } from '$lib/data/dialog-manager';
import { checkForUpdate, type UpdateInfo } from '$lib/functions/updater/check-for-update';
import { tImmediate } from '$lib/i18n';

/**
 * The update check someone asked for by hand. Unlike the silent startup
 * check, every outcome gets an answer — including "already up to date" and a
 * failure — because the person is waiting for one.
 */
export async function manualCheckUpdate() {
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
  }
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
