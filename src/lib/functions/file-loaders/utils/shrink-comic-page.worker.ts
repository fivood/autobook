/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Worker half of shrink-comic-page.ts — see there for why comic pages get
 * re-encoded at all, and why this runs off the main thread.
 *
 * Deliberately thin: the encode itself is imported rather than copied, so the
 * worker and the in-process fallback can never drift apart.
 */

import { encodeToScreenSize } from '$lib/functions/file-loaders/utils/shrink-comic-page';

self.onmessage = async (event: MessageEvent<{ blob: Blob }>) => {
  // encodeToScreenSize swallows decode failures and answers null, which the
  // pool reads as "keep the original bytes" — so there is nothing here that
  // needs a try/catch of its own.
  const blob = await encodeToScreenSize(event.data.blob);

  self.postMessage({ blob });
};

export {};
