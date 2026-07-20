/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const visualViewport: VisualViewport =
  typeof window !== 'undefined'
    ? window.visualViewport
    : ({
        addEventListener: () => 0,
        removeEventListener: () => 0
        // SSR/no-window stub — VisualViewport is browser-only; partial mock suffices for non-DOM envs.
      } as any);
