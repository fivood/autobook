/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

import { windowAlwaysOnTop$ } from '$lib/data/store';

/** Keep the window's always-on-top state in step with the setting, from
 * startup on. Tauri only — the caller checks. */
export function syncAlwaysOnTop() {
  windowAlwaysOnTop$.subscribe(async (on) => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(on);
    } catch (err) {
      // The switch would claim a state the window doesn't have; put it back.
      console.warn('[always-on-top] failed:', err);
      if (on) windowAlwaysOnTop$.next(false);
    }
  });
}
