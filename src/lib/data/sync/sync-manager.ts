// Orchestrates the cross-device sync loop. Subscribes to local statistic
// changes and pushes our device's daily totals to the server; periodically
// pulls remote state and writes contributions from OTHER devices into the
// local `statistic` store so the statistics page shows the aggregate without
// any extra logic. The local row's readingTime ends up being the cross-device
// sum; our own contribution is recoverable from a localStorage shadow cache.

import { database } from '$lib/data/store';
import {
  syncDeviceId$,
  syncEnabled$,
  syncLastAt$,
  syncToken$
} from '$lib/data/store';
import {
  flattenRemote,
  generateDeviceId,
  pullState,
  pushDelta,
  type RemoteState
} from '$lib/data/sync/sync-client';

const MY_CONTRIB_KEY = 'syncMyContrib';
const REMOTE_CACHE_KEY = 'syncRemoteState';
const PUSH_DEBOUNCE_MS = 30_000;
const PULL_INTERVAL_MS = 5 * 60_000;

interface MyContribState {
  /** books[title][dateKey] = secondsThisDeviceContributedSoFar. Kept as a raw
   * number for backward compatibility with pre-chars-sync caches — the chars
   * counterpart lives in the optional `booksChars` mirror. */
  books: Record<string, Record<string, number>>;
  /** books[title][dateKey] = charsThisDeviceContributedSoFar. Optional — an
   * older cache on disk simply won't have it, and reads must tolerate that. */
  booksChars?: Record<string, Record<string, number>>;
}

function loadMyContrib(): MyContribState {
  if (typeof localStorage === 'undefined') return { books: {} };
  try {
    const raw = localStorage.getItem(MY_CONTRIB_KEY);
    if (!raw) return { books: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.books === 'object') return parsed as MyContribState;
  } catch {
    // ignore
  }
  return { books: {} };
}

function saveMyContrib(state: MyContribState) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MY_CONTRIB_KEY, JSON.stringify(state));
}

export function loadCachedRemote(): RemoteState {
  if (typeof localStorage === 'undefined') return { v: 1, books: {} };
  try {
    const raw = localStorage.getItem(REMOTE_CACHE_KEY);
    if (!raw) return { v: 1, books: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1) return parsed as RemoteState;
  } catch {
    // ignore
  }
  return { v: 1, books: {} };
}

function saveCachedRemote(state: RemoteState) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(state));
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

export function ensureDeviceId(): string {
  let id = syncDeviceId$.getValue();
  if (!id) {
    id = generateDeviceId();
    syncDeviceId$.next(id);
  }
  return id;
}

/**
 * Read local statistics, take the per-(book, date) reading time + chars, and
 * build the wire payload. We only send entries that grew (in either dimension)
 * since the last successful push to keep payloads small.
 */
async function buildPushPayload(): Promise<{
  books: Record<
    string,
    Record<string, { clients: Record<string, number>; charsClients?: Record<string, number> }>
  >;
  changedKeys: Array<[string, string, number, number]>;
} | null> {
  const deviceId = ensureDeviceId();
  const db = await database.db;
  const stats = await db.getAll('statistic');
  const cache = loadMyContrib();
  const books: Record<
    string,
    Record<string, { clients: Record<string, number>; charsClients?: Record<string, number> }>
  > = {};
  const changed: Array<[string, string, number, number]> = [];
  for (const s of stats) {
    const localTime = s.readingTime || 0;
    const localChars = s.charactersRead || 0;
    if (localTime <= 0 && localChars <= 0) continue;
    const priorTime = cache.books[s.title]?.[s.dateKey] ?? -1;
    const priorChars = cache.booksChars?.[s.title]?.[s.dateKey] ?? -1;
    if (localTime === priorTime && localChars === priorChars) continue;
    books[s.title] = books[s.title] || {};
    const entry: {
      clients: Record<string, number>;
      charsClients?: Record<string, number>;
    } = { clients: { [deviceId]: localTime } };
    if (localChars > 0) {
      entry.charsClients = { [deviceId]: localChars };
    }
    books[s.title][s.dateKey] = entry;
    changed.push([s.title, s.dateKey, localTime, localChars]);
  }
  if (!changed.length) return null;
  return { books, changedKeys: changed };
}

async function applyRemoteToLocal(remote: RemoteState) {
  const deviceId = ensureDeviceId();
  const db = await database.db;
  const tx = db.transaction('statistic', 'readwrite');
  const store = tx.objectStore('statistic');
  const contrib = loadMyContrib();
  for (const row of flattenRemote(remote)) {
    if (!row.totalSeconds && !row.totalChars) continue;
    const key: [string, string] = [row.book, row.date];
    const existing = await store.get(key);
    const otherDevicesTime = Object.entries(row.clients)
      .filter(([id]) => id !== deviceId)
      .reduce((sum, [, sec]) => sum + sec, 0);
    const otherDevicesChars = Object.entries(row.charsClients)
      .filter(([id]) => id !== deviceId)
      .reduce((sum, [, c]) => sum + c, 0);
    if (!existing) {
      if (otherDevicesTime > 0 || otherDevicesChars > 0) {
        const speed =
          otherDevicesTime > 0 ? Math.ceil((3600 * otherDevicesChars) / otherDevicesTime) : 0;
        await store.put({
          title: row.book,
          dateKey: row.date,
          charactersRead: otherDevicesChars,
          readingTime: otherDevicesTime,
          minReadingSpeed: speed,
          altMinReadingSpeed: speed,
          lastReadingSpeed: speed,
          maxReadingSpeed: speed,
          lastStatisticModified: Date.now()
        });
      }
      continue;
    }
    const myTimeKnown = contrib.books[row.book]?.[row.date] ?? existing.readingTime;
    const myCharsKnown = contrib.booksChars?.[row.book]?.[row.date] ?? existing.charactersRead;
    const desiredTime = myTimeKnown + otherDevicesTime;
    const desiredChars = myCharsKnown + otherDevicesChars;
    const timeGrew = desiredTime > (existing.readingTime || 0);
    const charsGrew = desiredChars > (existing.charactersRead || 0);
    if (timeGrew || charsGrew) {
      await store.put({
        ...existing,
        readingTime: timeGrew ? desiredTime : existing.readingTime,
        charactersRead: charsGrew ? desiredChars : existing.charactersRead,
        lastStatisticModified: Date.now()
      });
    }
  }
  await tx.done;
  saveCachedRemote(remote);
}

export async function pushNow(): Promise<{ pushed: number } | null> {
  const token = syncToken$.getValue();
  if (!token || !syncEnabled$.getValue() || inFlight) return null;
  const payload = await buildPushPayload();
  if (!payload) return { pushed: 0 };
  inFlight = true;
  try {
    const merged = await pushDelta(token, { books: payload.books });
    const cache = loadMyContrib();
    for (const [title, date, timeSec, chars] of payload.changedKeys) {
      cache.books[title] = cache.books[title] || {};
      cache.books[title][date] = timeSec;
      if (chars > 0) {
        cache.booksChars = cache.booksChars || {};
        cache.booksChars[title] = cache.booksChars[title] || {};
        cache.booksChars[title][date] = chars;
      }
    }
    saveMyContrib(cache);
    saveCachedRemote(merged);
    syncLastAt$.next(Date.now());
    return { pushed: payload.changedKeys.length };
  } finally {
    inFlight = false;
  }
}

export async function pullNow(): Promise<RemoteState | null> {
  const token = syncToken$.getValue();
  if (!token || !syncEnabled$.getValue()) return null;
  const remote = await pullState(token);
  await applyRemoteToLocal(remote);
  syncLastAt$.next(Date.now());
  return remote;
}

export function scheduleDebouncedPush() {
  if (!syncEnabled$.getValue() || !syncToken$.getValue()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushNow().catch((err) => {
      console.warn('[sync] push failed', err);
    });
  }, PUSH_DEBOUNCE_MS);
}

let started = false;
export function startSyncLoop() {
  if (started || typeof window === 'undefined') return;
  started = true;
  ensureDeviceId();
  syncEnabled$.subscribe((on) => {
    if (!on) {
      if (pullTimer) clearInterval(pullTimer);
      pullTimer = undefined;
      return;
    }
    pullNow().catch((err) => console.warn('[sync] initial pull failed', err));
    if (!pullTimer) {
      pullTimer = setInterval(() => {
        pullNow().catch((err) => console.warn('[sync] periodic pull failed', err));
      }, PULL_INTERVAL_MS);
    }
  });
  database.statisticsChanged$.subscribe(() => scheduleDebouncedPush());
}

export function stopSyncLoop() {
  if (pushTimer) clearTimeout(pushTimer);
  if (pullTimer) clearInterval(pullTimer);
  pushTimer = undefined;
  pullTimer = undefined;
  inFlight = false;
  started = false;
}
