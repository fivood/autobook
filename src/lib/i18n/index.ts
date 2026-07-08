// Minimal i18n runtime. 0 deps, ~100 lines. Layered rollout — only
// keys used by translated components need to exist. Untranslated keys
// fall back to zh (the origin language) so partial coverage is safe:
// a settings panel we haven't touched still renders Chinese for all
// three locales rather than exploding into "settings.title" placeholders.
//
// Why not svelte-i18n / paraglide: 3 locales + no complex plurals or
// interpolation math means the imported library would be bigger than
// this file. Trade-off accepted: no async loading (all locales live in
// the main bundle — ~20 KB total once populated), no ICU MessageFormat
// (a template-literal interpolation is enough).
import { writable, derived, get, type Readable } from 'svelte/store';
import zh from './zh';
import en from './en';
import ja from './ja';

const STORAGE_KEY = 'locale';

export type Locale = 'zh' | 'en' | 'ja';
export const LOCALES: Locale[] = ['zh', 'en', 'ja'];
export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語'
};

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { zh, en, ja };

/** Persisted locale. Reads localStorage on load; auto-detects browser
 * language on first visit. */
function detectDefault(): Locale {
  if (typeof navigator === 'undefined') return 'zh';
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('zh')) return 'zh';
  // Everything else defaults to English rather than Chinese — a French
  // user seeing 中文 is a worse first impression than seeing English.
  return 'en';
}

function readStored(): Locale {
  if (typeof localStorage === 'undefined') return detectDefault();
  const raw = localStorage.getItem(STORAGE_KEY);
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : detectDefault();
}

export const locale$ = writable<Locale>(readStored());
locale$.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, v);
});

/** Interpolate `{name}` placeholders. Values are HTML-escaped by
 * Svelte's default text rendering, so no XSS via user-supplied vars. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Lookup with locale → zh → key fallback. Never throws; missing keys
 * just render the key itself so mistakes are visible without breaking
 * the page. */
function lookup(loc: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[loc]?.[key] ?? DICTS.zh[key] ?? key;
  return interpolate(raw, vars);
}

/** Reactive translator. Usage in Svelte: `{$t('books.import')}` or
 * `{$t('books.progress', { pct: 42 })}`. Re-renders on locale switch. */
export const t: Readable<(key: string, vars?: Record<string, string | number>) => string> = derived(
  locale$,
  (loc) => (key: string, vars?: Record<string, string | number>) => lookup(loc, key, vars)
);

/** Non-reactive lookup for imperative code (dialog messages built in
 * event handlers, error strings, etc.). Reads the current store value. */
export function tImmediate(key: string, vars?: Record<string, string | number>): string {
  return lookup(get(locale$), key, vars);
}
