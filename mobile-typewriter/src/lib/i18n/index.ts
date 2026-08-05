// Minimal PWA i18n runtime. Mirrors the desktop package's approach
// (self-contained store + t/tImmediate + 3 flat dicts) but is DELIBERATELY
// a separate module — the PWA has completely different UI text than
// desktop (no notebook, no AI drawer, no keyboard-shortcuts panel, etc.)
// so key sharing would just create dead entries in one side or the
// other. See src/lib/i18n/index.ts in the desktop package for the
// same design rationale.
import { writable, derived, get, type Readable } from 'svelte/store';
import zh from './zh';
import en from './en';
import ja from './ja';

export type Locale = 'zh' | 'en' | 'ja';
export const LOCALES: Locale[] = ['zh', 'en', 'ja'];
export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語'
};

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { zh, en, ja };
const STORAGE_KEY = 'tw-locale';

function detectDefault(): Locale {
  // `typeof navigator === 'undefined'` used to mean "running on the server",
  // but Node 21 added a global `navigator`, so the guard no longer holds. It
  // is inert here today because +layout.ts sets `ssr = false`, which keeps
  // this out of the prerender pass entirely — but the desktop build, which
  // does prerender, shipped every page in the build machine's ICU language
  // and flashed it for a frame before hydration. Fixed on both sides so
  // turning SSR back on here (for SEO, say) can't quietly reintroduce it.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'zh';
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('zh')) return 'zh';
  return 'en';
}

function readStored(): Locale {
  // Same reasoning — Node 22 can expose a global localStorage behind a flag,
  // so gate on the browser itself rather than on the API's existence.
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return detectDefault();
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : detectDefault();
}

export const locale$ = writable<Locale>(readStored());
locale$.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v);
});

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function lookup(loc: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[loc]?.[key] ?? DICTS.zh[key] ?? key;
  return interpolate(raw, vars);
}

export const t: Readable<(key: string, vars?: Record<string, string | number>) => string> = derived(
  locale$,
  (loc) => (key: string, vars?: Record<string, string | number>) => lookup(loc, key, vars)
);

export function tImmediate(key: string, vars?: Record<string, string | number>): string {
  return lookup(get(locale$), key, vars);
}
