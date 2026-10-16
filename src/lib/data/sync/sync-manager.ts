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
  syncLastError$,
  syncToken$
} from '$lib/data/store';
import {
  flattenRemote,
  generateDeviceId,
  pullState,
  pushDelta,
  sumModeField,
  type ModeTotals,
  type RemoteState
} from '$lib/data/sync/sync-client';

/** Wire field to statistic-row field. The wire names are short because they
 *  repeat per device per book per day inside a 2 MB KV blob. */
const MODE_KEYS = ['ttsSeconds', 'ttsChars', 'twSeconds', 'twChars'] as const;
type ModeKey = (typeof MODE_KEYS)[number];
const DB_FIELD = {
  ttsSeconds: 'ttsSeconds',
  ttsChars: 'ttsCharacters',
  twSeconds: 'typewriterSeconds',
  twChars: 'typewriterCharacters'
} as const;
type DbModeField = (typeof DB_FIELD)[ModeKey];

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
  /** othersBooks[title][dateKey] = seconds contributed by OTHER devices (sum),
   * recorded on the last pull. `readingTime` in the DB is the cross-device sum,
   * so our own contribution must be recovered as `readingTime - others`. */
  othersBooks?: Record<string, Record<string, number>>;
  /** othersBooksChars[title][dateKey] = chars contributed by OTHER devices (sum). */
  othersBooksChars?: Record<string, Record<string, number>>;
  /** modes[title][dateKey] = this device's playback split as last pushed. */
  modes?: Record<string, Record<string, ModeTotals>>;
  /** othersModes[title][dateKey] = playback split contributed by OTHER devices. */
  othersModes?: Record<string, Record<string, ModeTotals>>;
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
interface PushEntry {
  clients: Record<string, number>;
  charsClients?: Record<string, number>;
  modes?: Record<string, ModeTotals>;
}

interface ChangedKey {
  title: string;
  date: string;
  time: number;
  chars: number;
  modes: ModeTotals;
}

async function buildPushPayload(): Promise<{
  books: Record<string, Record<string, PushEntry>>;
  changedKeys: ChangedKey[];
} | null> {
  const deviceId = ensureDeviceId();
  const db = await database.db;
  const stats = await db.getAll('statistic');
  const cache = loadMyContrib();
  const books: Record<string, Record<string, PushEntry>> = {};
  const changed: ChangedKey[] = [];
  for (const s of stats) {
    const totalTime = s.readingTime || 0;
    const totalChars = s.charactersRead || 0;
    if (totalTime <= 0 && totalChars <= 0) continue;
    // Our own contribution = local total minus what other devices already
    // contributed (captured on the last pull). Pushing the raw `readingTime`
    // would send the cross-device sum as "this device", and the worker's
    // per-device max() merge would then grow monotonically forever.
    const othersTime = cache.othersBooks?.[s.title]?.[s.dateKey] ?? 0;
    const othersChars = cache.othersBooksChars?.[s.title]?.[s.dateKey] ?? 0;
    const myTime = Math.max(0, totalTime - othersTime);
    const myChars = Math.max(0, totalChars - othersChars);
    if (myTime <= 0 && myChars <= 0) continue;
    // The playback split gets the same treatment, one field at a time.
    const othersModes = cache.othersModes?.[s.title]?.[s.dateKey] || {};
    const localModes: Record<ModeKey, number> = {
      ttsSeconds: s.ttsSeconds || 0,
      ttsChars: s.ttsCharacters || 0,
      twSeconds: s.typewriterSeconds || 0,
      twChars: s.typewriterCharacters || 0
    };
    const myModes: ModeTotals = {};
    for (const key of MODE_KEYS) {
      const mine = Math.max(0, localModes[key] - (othersModes[key] || 0));
      if (mine > 0) myModes[key] = mine;
    }
    const priorTime = cache.books[s.title]?.[s.dateKey] ?? -1;
    const priorChars = cache.booksChars?.[s.title]?.[s.dateKey] ?? -1;
    const priorModes = cache.modes?.[s.title]?.[s.dateKey] || {};
    // The split is part of the "did anything change" test, not just the totals:
    // a day already pushed by a pre-1.47 build has its totals cached and would
    // otherwise never be re-sent, leaving its split missing forever.
    const modesUnchanged = MODE_KEYS.every(
      (key) => (myModes[key] || 0) === (priorModes[key] || 0)
    );
    if (myTime === priorTime && myChars === priorChars && modesUnchanged) continue;
    books[s.title] = books[s.title] || {};
    const entry: PushEntry = { clients: { [deviceId]: myTime } };
    if (myChars > 0) {
      entry.charsClients = { [deviceId]: myChars };
    }
    if (Object.keys(myModes).length) {
      entry.modes = { [deviceId]: myModes };
    }
    books[s.title][s.dateKey] = entry;
    changed.push({ title: s.title, date: s.dateKey, time: myTime, chars: myChars, modes: myModes });
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
    // Persist the "others" baseline so buildPushPayload can subtract it from
    // the (summed) readingTime to recover our own contribution.
    contrib.othersBooks = contrib.othersBooks || {};
    contrib.othersBooks[row.book] = contrib.othersBooks[row.book] || {};
    contrib.othersBooks[row.book][row.date] = otherDevicesTime;
    contrib.othersBooksChars = contrib.othersBooksChars || {};
    contrib.othersBooksChars[row.book] = contrib.othersBooksChars[row.book] || {};
    contrib.othersBooksChars[row.book][row.date] = otherDevicesChars;
    const otherDevicesModes: ModeTotals = {};
    for (const key of MODE_KEYS) {
      otherDevicesModes[key] = sumModeField(row.modes, key, deviceId);
    }
    contrib.othersModes = contrib.othersModes || {};
    contrib.othersModes[row.book] = contrib.othersModes[row.book] || {};
    contrib.othersModes[row.book][row.date] = otherDevicesModes;
    if (!existing) {
      if (otherDevicesTime > 0 || otherDevicesChars > 0) {
        const speed =
          otherDevicesTime > 0 ? Math.ceil((3600 * otherDevicesChars) / otherDevicesTime) : 0;
        // Carry the split onto the new row too. Without it a book read only on
        // another device produced a row with time but no breakdown, and the
        // year page counted that time as belonging to no reading mode at all.
        const modeFields: Partial<Record<DbModeField, number>> = {};
        for (const key of MODE_KEYS) {
          const value = otherDevicesModes[key] || 0;
          if (value > 0) modeFields[DB_FIELD[key]] = value;
        }
        await store.put({
          title: row.book,
          dateKey: row.date,
          charactersRead: otherDevicesChars,
          readingTime: otherDevicesTime,
          minReadingSpeed: speed,
          altMinReadingSpeed: speed,
          lastReadingSpeed: speed,
          maxReadingSpeed: speed,
          lastStatisticModified: Date.now(),
          ...modeFields
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
    const myModesKnown = contrib.modes?.[row.book]?.[row.date];
    const modeFields: Partial<Record<DbModeField, number>> = {};
    let modesGrew = false;
    for (const key of MODE_KEYS) {
      const dbField = DB_FIELD[key];
      const mine = myModesKnown?.[key] ?? existing[dbField] ?? 0;
      const desired = mine + (otherDevicesModes[key] || 0);
      if (desired > (existing[dbField] || 0)) {
        modeFields[dbField] = desired;
        modesGrew = true;
      }
    }
    if (timeGrew || charsGrew || modesGrew) {
      await store.put({
        ...existing,
        ...modeFields,
        readingTime: timeGrew ? desiredTime : existing.readingTime,
        charactersRead: charsGrew ? desiredChars : existing.charactersRead,
        lastStatisticModified: Date.now()
      });
    }
  }
  await tx.done;
  saveMyContrib(contrib);
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
    for (const { title, date, time, chars, modes } of payload.changedKeys) {
      cache.books[title] = cache.books[title] || {};
      cache.books[title][date] = time;
      if (chars > 0) {
        cache.booksChars = cache.booksChars || {};
        cache.booksChars[title] = cache.booksChars[title] || {};
        cache.booksChars[title][date] = chars;
      }
      cache.modes = cache.modes || {};
      cache.modes[title] = cache.modes[title] || {};
      cache.modes[title][date] = modes;
    }
    saveMyContrib(cache);
    saveCachedRemote(merged);
    syncLastAt$.next(Date.now());
    syncLastError$.next('');
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
  syncLastError$.next('');
  return remote;
}

/** pullState/pushDelta reject with a `SyncError` ({status, message}) on an HTTP
 *  error and with a TypeError when fetch itself could not reach the worker;
 *  neither stringifies usefully on its own. */
function describeSyncError(kind: 'push' | 'pull', err: any): string {
  const status = typeof err?.status === 'number' ? ` (HTTP ${err.status})` : '';
  const detail = err?.message || (typeof err === 'string' ? err : '网络不可达');
  return `${kind === 'push' ? '上传' : '下载'}失败${status}：${detail}`;
}

function scheduleDebouncedPush() {
  if (!syncEnabled$.getValue() || !syncToken$.getValue()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushNow().catch((err) => {
      console.warn('[sync] push failed', err);
      syncLastError$.next(describeSyncError('push', err));
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
    pullNow().catch((err) => {
      console.warn('[sync] initial pull failed', err);
      syncLastError$.next(describeSyncError('pull', err));
    });
    if (!pullTimer) {
      pullTimer = setInterval(() => {
        pullNow().catch((err) => {
          console.warn('[sync] periodic pull failed', err);
          syncLastError$.next(describeSyncError('pull', err));
        });
      }, PULL_INTERVAL_MS);
    }
  });
  database.statisticsChanged$.subscribe(() => scheduleDebouncedPush());
}
