/// <reference types="@sveltejs/kit" />
/// <reference types="wicg-file-system-access" />
/// <reference types="webappsec-credential-management" />

// See https://kit.svelte.dev/docs/types#the-app-namespace
// for information about these interfaces
declare namespace App {
  // interface Locals {}
  // interface Platform {}
  // interface Session {}
  // interface Stuff {}
}

declare global {
  interface HTMLElement {
    scrollIntoViewIfNeeded(arg?: boolean): void;
  }
  interface Navigator {
    msMaxTouchPoints: number;
    standalone: boolean | undefined;
  }
}

// Svelte-kit 2.x generates types that reference svelte.Snippet (Svelte 5),
// but this project pins Svelte 4 — provide a shim so the generated $types
// files type-check.
declare module 'svelte' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Snippet<T extends unknown[] = any[]> = (...args: T) => unknown;
}

export {};
