/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LimitFunction } from 'p-limit';
import { logger } from '$lib/data/logger';
import { replicationProgress$ } from '$lib/functions/replication/replication-progress';

export function handleErrorDuringReplication(
  error: any,
  baseError = '',
  limiters?: LimitFunction[],
  currentProgressBase?: number
) {
  const errorMsg = error?.message || error?.name || (typeof error === 'string' ? error : String(error));
  if (error?.name !== 'AbortError') {
    logger.error(`${baseError}${errorMsg}`);
  }

  if (error.name === 'AbortError') {
    if (limiters) {
      for (let index = 0, { length } = limiters; index < length; index += 1) {
        limiters[index].clearQueue();
      }
    }

    throw error;
  }

  if (currentProgressBase !== undefined) {
    replicationProgress$.next({ progressBase: currentProgressBase, skipStep: true });
  } else {
    replicationProgress$.next({ skipStep: true });
  }

  return `${baseError}${errorMsg}`;
}
