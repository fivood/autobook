// Reading-time tracker for the mobile typewriter. Increments seconds for the
// currently open book whenever a tick fires AND the typewriter is actively
// revealing (i.e. user can be reading). Persists to localStorage and pushes
// to sync.fivood.com on a debounce.

import {
  generateDeviceId,
  generateToken,
  isValidToken,
  pullState,
  pushDelta,
  type RemoteState
} from './sync-client';

const LOCAL_STATS_KEY = 'tw-stats';
const TOKEN_KEY = 'tw-sync-token';
const DEVICE_KEY = 'tw-device-id';
const ENABLED_KEY = 'tw-sync-enabled';
const LAST_AT_KEY = 'tw-sync-last-at';
const PUSH_DEBOUNCE_MS = 20_000;
const PULL_INTERVAL_MS = 5 * 60_000;

interface LocalStats {
  /** my-device-only: books[title][YYYY-MM-DD] = secondsByThisDevice */
  books: Record<string, Record<string, number>>;
}

function ls(): Storage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

function readJson<T>(key: string, fallback: T): T {
  const s = ls();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  const s = ls();
  if (!s) return;
  s.setItem(key, JSON.stringify(value));
}

function readString(key: string): string {
  const s = ls();
  if (!s) return '';
  return s.getItem(key) || '';
}

function writeString(key: string, value: string) {
  const s = ls();
  if (!s) return;
  if (value) s.setItem(key, value);
  else s.removeItem(key);
}

export function getSyncToken(): string {
  return readString(TOKEN_KEY);
}
export function setSyncToken(t: string) {
  writeString(TOKEN_KEY, t.trim().toLowerCase());
}
export function getDeviceId(): string {
  let id = readString(DEVICE_KEY);
  if (!id) {
    id = generateDeviceId();
    writeString(DEVICE_KEY, id);
  }
  return id;
}
export function isSyncEnabled(): boolean {
  return readString(ENABLED_KEY) === '1';
}
export function setSyncEnabled(on: boolean) {
  writeString(ENABLED_KEY, on ? '1' : '');
}
export function getLastSyncAt(): number {
  return Number(readString(LAST_AT_KEY)) || 0;
}
function setLastSyncAt(ts: number) {
  writeString(LAST_AT_KEY, String(ts));
}
export { generateToken, isValidToken };

function loadStats(): LocalStats {
  return readJson<LocalStats>(LOCAL_STATS_KEY, { books: {} });
}
function saveStats(s: LocalStats) {
  writeJson(LOCAL_STATS_KEY, s);
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;
let pushing = false;

export function addReadingSeconds(bookTitle: string, seconds: number) {
  if (!bookTitle || seconds <= 0) return;
  const stats = loadStats();
  const date = todayKey();
  stats.books[bookTitle] = stats.books[bookTitle] || {};
  stats.books[bookTitle][date] = (stats.books[bookTitle][date] || 0) + seconds;
  saveStats(stats);
  schedulePush();
}

export function getLocalStats(): LocalStats {
  return loadStats();
}

/** Compute today's reading total across ALL devices for a book, merging local
 * device contribution with the last-pulled remote snapshot. */
export function getTodayTotal(bookTitle: string, remote?: RemoteState): number {
  const date = todayKey();
  const localMine = loadStats().books[bookTitle]?.[date] || 0;
  if (!remote) return localMine;
  const dayEntry = remote.books?.[bookTitle]?.[date];
  if (!dayEntry?.clients) return localMine;
  const me = getDeviceId();
  let otherDevices = 0;
  for (const [id, sec] of Object.entries(dayEntry.clients)) {
    if (id !== me) otherDevices += sec;
  }
  return localMine + otherDevices;
}

function schedulePush() {
  if (!isSyncEnabled() || !getSyncToken()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushNow().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[sync] push failed', err);
    });
  }, PUSH_DEBOUNCE_MS);
}

export async function pushNow(): Promise<{ pushed: number } | null> {
  const token = getSyncToken();
  if (!token || !isValidToken(token) || !isSyncEnabled() || pushing) return null;
  const stats = loadStats();
  const device = getDeviceId();
  const payload: {
    books: Record<string, Record<string, { clients: Record<string, number> }>>;
  } = { books: {} };
  let count = 0;
  for (const [book, dates] of Object.entries(stats.books)) {
    for (const [date, sec] of Object.entries(dates)) {
      if (sec <= 0) continue;
      payload.books[book] = payload.books[book] || {};
      payload.books[book][date] = { clients: { [device]: Math.round(sec) } };
      count += 1;
    }
  }
  if (!count) return { pushed: 0 };
  pushing = true;
  try {
    await pushDelta(token, payload);
    setLastSyncAt(Date.now());
    return { pushed: count };
  } finally {
    pushing = false;
  }
}

export async function pullNow(): Promise<RemoteState | null> {
  const token = getSyncToken();
  if (!token || !isValidToken(token) || !isSyncEnabled()) return null;
  const remote = await pullState(token);
  setLastSyncAt(Date.now());
  return remote;
}

export function startSyncLoop() {
  if (typeof window === 'undefined') return;
  getDeviceId();
  if (pullTimer) clearInterval(pullTimer);
  if (isSyncEnabled() && getSyncToken()) {
    pullNow().catch((err) => console.warn('[sync] initial pull failed', err));
    pullTimer = setInterval(() => {
      pullNow().catch((err) => console.warn('[sync] periodic pull failed', err));
    }, PULL_INTERVAL_MS);
  }
}
