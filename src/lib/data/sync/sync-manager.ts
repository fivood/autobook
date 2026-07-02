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
  /** books[title][dateKey] = secondsThisDeviceContributedSoFar */
  books: Record<string, Record<string, number>>;
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
 * Read local statistics, take the per-(book, date) reading time, treat it as
 * THIS DEVICE's contribution for the day, and build the wire payload. We send
 * only entries that grew since the last successful push to keep payloads small.
 */
async function buildPushPayload(): Promise<{
  books: Record<string, Record<string, { clients: Record<string, number> }>>;
  changedKeys: Array<[string, string]>;
} | null> {
  const deviceId = ensureDeviceId();
  const db = await database.db;
  const stats = await db.getAll('statistic');
  const cache = loadMyContrib();
  const books: Record<string, Record<string, { clients: Record<string, number> }>> = {};
  const changed: Array<[string, string]> = [];
  for (const s of stats) {
    const local = s.readingTime || 0;
    if (local <= 0) continue;
    const prior = cache.books[s.title]?.[s.dateKey] ?? -1;
    if (local === prior) continue;
    books[s.title] = books[s.title] || {};
    books[s.title][s.dateKey] = { clients: { [deviceId]: local } };
    changed.push([s.title, s.dateKey]);
  }
  if (!changed.length) return null;
  return { books, changedKeys: changed };
}

async function applyRemoteToLocal(remote: RemoteState) {
  const deviceId = ensureDeviceId();
  const db = await database.db;
  const tx = db.transaction('statistic', 'readwrite');
  const store = tx.objectStore('statistic');
  for (const row of flattenRemote(remote)) {
    if (!row.totalSeconds) continue;
    const key: [string, string] = [row.book, row.date];
    const existing = await store.get(key);
    const otherDevices = Object.entries(row.clients)
      .filter(([id]) => id !== deviceId)
      .reduce((sum, [, sec]) => sum + sec, 0);
    if (!existing) {
      if (otherDevices > 0) {
        await store.put({
          title: row.book,
          dateKey: row.date,
          charactersRead: 0,
          readingTime: otherDevices,
          minReadingSpeed: 0,
          altMinReadingSpeed: 0,
          lastReadingSpeed: 0,
          maxReadingSpeed: 0,
          lastStatisticModified: Date.now()
        });
      }
      continue;
    }
    const myContribKnown =
      loadMyContrib().books[row.book]?.[row.date] ?? existing.readingTime;
    const desired = myContribKnown + otherDevices;
    if (desired > (existing.readingTime || 0)) {
      await store.put({ ...existing, readingTime: desired, lastStatisticModified: Date.now() });
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
    for (const [title, date] of payload.changedKeys) {
      cache.books[title] = cache.books[title] || {};
      cache.books[title][date] = payload.books[title][date].clients[ensureDeviceId()];
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
