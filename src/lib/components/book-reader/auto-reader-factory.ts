/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Observable } from 'rxjs';
import { isTauri } from '$lib/data/env';
import { AutoReaderContinuous } from './auto-reader';
import { AutoReaderSapi } from './auto-reader-sapi';
import type { AutoReader } from './types';

export function createAutoReader(engine: string, destroy$: Observable<void>): AutoReader {
  if (engine === 'sapi' && isTauri()) {
    return new AutoReaderSapi(destroy$);
  }
  return new AutoReaderContinuous(destroy$);
}
