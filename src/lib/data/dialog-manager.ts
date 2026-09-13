/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writableSubject } from '$lib/functions/svelte/store';

export interface Dialog {
  component: (new (...args: any[]) => any) | string;
  props?: Record<string, any>;
  disableCloseOnClick?: boolean;
  zIndex?: string;
}

const dialogs$ = writableSubject<Dialog[]>([]);

export const dialogManager = {
  dialogs$
};
