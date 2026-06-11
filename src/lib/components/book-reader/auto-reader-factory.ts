/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Observable } from 'rxjs';
import { isTauri } from '$lib/data/env';
import { AutoReaderContinuous } from './auto-reader';
import { AutoReaderEdge } from './auto-reader-edge';
import { AutoReaderPiper } from './auto-reader-piper';
import { AutoReaderSapi } from './auto-reader-sapi';
import type { AutoReader } from './types';

export function createAutoReader(engine: string, destroy$: Observable<void>): AutoReader {
  if (isTauri()) {
    if (engine === 'sapi') return new AutoReaderSapi(destroy$);
    if (engine === 'edge') return new AutoReaderEdge(destroy$);
    if (engine === 'piper') return new AutoReaderPiper(destroy$);
  }
  return new AutoReaderContinuous(destroy$);
}
