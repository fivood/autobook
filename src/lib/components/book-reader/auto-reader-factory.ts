/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { Observable } from 'rxjs';
import { isTauri } from '$lib/data/env';
import { AutoReaderContinuous } from './auto-reader';
import { AutoReaderCustom } from './auto-reader-custom';
import { AutoReaderKokoro } from './auto-reader-kokoro';
import { AutoReaderSapi } from './auto-reader-sapi';
import type { AutoReader } from './types';

export function createAutoReader(engine: string, destroy$: Observable<void>): AutoReader {
  // Kokoro is browser-side ONNX so it's available in both Tauri and web builds.
  if (engine === 'kokoro') return new AutoReaderKokoro(destroy$);
  if (isTauri()) {
    if (engine === 'sapi') return new AutoReaderSapi(destroy$);
    if (engine === 'custom') return new AutoReaderCustom(destroy$);
  }
  return new AutoReaderContinuous(destroy$);
}
