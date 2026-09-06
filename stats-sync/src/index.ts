// AutoBook reading-time sync worker.
//
// Storage model: one KV value per user token holding the full multi-book,
// multi-device state. Reads are tiny; writes use a per-client counter so two
// devices reading the same book on the same day sum instead of clobbering
// each other.
//
//   /sync?token=<32hex>   GET  → returns the user's full state
//                         POST → merges body into state, returns merged state
//   /health               GET  → ok
//
// Token format: 32 hex chars, generated client-side. No registration; the
// token IS the credential. If a token leaks, the user rotates to a new one.

export interface Env {
  STATS: KVNamespace;
}

const TOKEN_RE = /^[0-9a-f]{32}$/i;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB per push is plenty for daily deltas
const MAX_STATE_BYTES = 2 * 1024 * 1024; // hard cap to keep KV reads cheap
const MAX_REPORT_BYTES = 64 * 1024; // anonymous error reports

const REPORT_TYPES = ['error', 'install', 'update', 'import'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

interface ReportPayload {
  type: ReportType;
  version?: string;
  currentVersion?: string;
  targetVersion?: string;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp?: number;
  userAgent?: string;
}

/**
 * How much of a device's day came from playback rather than manual reading.
 * One map instead of four sibling `*Clients` buckets: the split is always
 * reported together and is meaningless split apart, and the merge rule is
 * per-field max either way.
 *
 * Optional at every level. The PWA has no TTS and never sends it, desktop
 * builds before 1.47 don't either, and a device that only read manually has
 * nothing to put in it — so a missing split means "unknown", not "zero".
 */
interface ModeTotals {
  ttsSeconds?: number;
  ttsChars?: number;
  twSeconds?: number;
  twChars?: number;
}

interface DayEntry {
  /** Per-device daily totals; server keeps max(client-reported) per device. */
  clients: Record<string, number>;
  /** Per-device chars-read totals; merged with the same max-by-device rule.
   * Absent for days only pushed by pre-chars-sync clients. */
  charsClients?: Record<string, number>;
  /** modes[deviceId] = that device's playback share of the totals above. */
  modes?: Record<string, ModeTotals>;
  /** Server-side last update millis. */
  updatedAt: number;
}

const MODE_FIELDS = ['ttsSeconds', 'ttsChars', 'twSeconds', 'twChars'] as const;

const SECONDS_IN_DAY = 86400;

export interface UserState {
  /** Schema bump knob for future migrations. */
  v: 1;
  /** books[bookTitle][dateKey YYYY-MM-DD] = DayEntry */
  books: Record<string, Record<string, DayEntry>>;
}

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Max-Age': '86400'
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...(init.headers || {})
    }
  });
}

/**
 * The token is the whole credential, so it belongs in a header — a query
 * string lands in access logs, proxy logs and `Referer`.
 *
 * The query parameter stays supported indefinitely, not just transitionally:
 * the PWA client lives on the `release/1.6.0` branch and ships on its own
 * schedule, and older desktop builds in the wild never stop sending it.
 * Dropping it here would silently break their sync.
 */
function readToken(request: Request, url: URL): string {
  const bearer = /^\s*Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') || '');
  const raw = bearer?.[1] || url.searchParams.get('token') || '';
  return raw.trim().toLowerCase();
}

function emptyState(): UserState {
  return { v: 1, books: {} };
}

/** Thrown when a stored blob exists but cannot be trusted. Never swallowed. */
class UnreadableState extends Error {}

/**
 * A missing key is a new user — an empty state is the right answer.
 *
 * Anything else is not. This used to fall back to `emptyState()` on a parse
 * failure or an unexpected `v`, with a comment claiming "the client's next
 * push will rebuild". It does not: the client keeps its own record of what it
 * has already pushed and skips those days, so a reset here loses this
 * device's history permanently and the other device's along with it — with
 * nobody told. The same branch would have fired on the first read after any
 * future schema bump, wiping every user's state at once.
 *
 * So: refuse. The blob stays in KV for whoever has to look at it, the client
 * surfaces a sync error, and nothing is overwritten.
 */
async function loadState(env: Env, token: string): Promise<UserState> {
  const raw = await env.STATS.get(token);
  if (!raw) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UnreadableState('stored state is not valid JSON');
  }
  const candidate = parsed as Partial<UserState> | null;
  if (!candidate || typeof candidate.books !== 'object' || candidate.books === null) {
    throw new UnreadableState('stored state has no books map');
  }
  if (candidate.v !== 1) {
    throw new UnreadableState(`stored state has unsupported version ${String(candidate.v)}`);
  }
  return candidate as UserState;
}

async function saveState(env: Env, token: string, state: UserState): Promise<void> {
  const body = JSON.stringify(state);
  if (body.length > MAX_STATE_BYTES) {
    throw new Error('state too large');
  }
  await env.STATS.put(token, body);
}

interface IncomingPayload {
  books?: Record<
    string,
    Record<
      string,
      {
        clients?: Record<string, number>;
        charsClients?: Record<string, number>;
        modes?: Record<string, ModeTotals>;
      }
    >
  >;
}

/**
 * Every bucket merges the same way: a device's number only ever moves up. That
 * is what makes a retry, a stale client, or two pushes arriving out of order
 * harmless — none of them can take time away.
 */
function mergeMaxInto(
  target: Record<string, number>,
  incoming: Record<string, unknown> | undefined,
  cap: number
): boolean {
  let changed = false;
  for (const [clientId, value] of Object.entries(incoming || {})) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0) continue;
    const capped = Math.min(value, cap);
    if (capped > (target[clientId] || 0)) {
      target[clientId] = capped;
      changed = true;
    }
  }
  return changed;
}

// Exported for scripts/stats-sync-merge-test.ts — the merge rule is the one
// place a bug silently eats another device'''s history, so it gets a test.
export function mergeInto(
  server: UserState,
  incoming: IncomingPayload,
  now: number
): UserState {
  if (!incoming.books) return server;
  for (const [book, dates] of Object.entries(incoming.books)) {
    if (!book || typeof dates !== 'object' || dates === null) continue;
    let serverBook = server.books[book];
    if (!serverBook) {
      serverBook = {};
      server.books[book] = serverBook;
    }
    for (const [date, entry] of Object.entries(dates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!entry || typeof entry !== 'object') continue;
      let day = serverBook[date];
      if (!day) {
        day = { clients: {}, updatedAt: now };
        serverBook[date] = day;
      }
      // can't read more than 24h in a day
      let changed = mergeMaxInto(day.clients, entry.clients, SECONDS_IN_DAY);

      const incomingChars = entry.charsClients;
      if (incomingChars) {
        const charsTarget = day.charsClients || {};
        if (mergeMaxInto(charsTarget, incomingChars, Number.POSITIVE_INFINITY)) {
          day.charsClients = charsTarget;
          changed = true;
        }
      }

      // Same max-per-device rule, one level deeper: max each field of each
      // device's split independently. Never derived from `clients` — a device
      // that reads both by hand and by playback has a split strictly smaller
      // than its total, and only that device knows the breakdown.
      for (const [clientId, totals] of Object.entries(entry.modes || {})) {
        if (!totals || typeof totals !== 'object') continue;
        const current: ModeTotals = { ...(day.modes?.[clientId] || {}) };
        let deviceChanged = false;
        for (const field of MODE_FIELDS) {
          const value = (totals as Record<string, unknown>)[field];
          if (typeof value !== 'number' || !isFinite(value) || value < 0) continue;
          const capped = field.endsWith('Seconds') ? Math.min(value, SECONDS_IN_DAY) : value;
          if (capped > (current[field] || 0)) {
            current[field] = capped;
            deviceChanged = true;
          }
        }
        if (deviceChanged) {
          if (!day.modes) day.modes = {};
          day.modes[clientId] = current;
          changed = true;
        }
      }

      if (changed) day.updatedAt = now;
    }
  }
  return server;
}

function generateReportId(): string {
  // crypto.randomUUID is available in Cloudflare Workers.
  return crypto.randomUUID();
}

async function saveReport(env: Env, id: string, payload: ReportPayload): Promise<void> {
  const body = JSON.stringify({ ...payload, receivedAt: Date.now(), id });
  if (body.length > MAX_REPORT_BYTES) {
    throw new Error('report too large');
  }
  await env.STATS.put(`report:${id}`, body);
}

function isValidReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && REPORT_TYPES.includes(value as ReportType);
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_REPORT_BYTES) {
    return json({ error: 'payload too large' }, { status: 413 });
  }
  let payload: ReportPayload;
  try {
    payload = (await request.json()) as ReportPayload;
  } catch {
    return json({ error: 'invalid json' }, { status: 400 });
  }
  if (!isValidReportType(payload.type)) {
    return json({ error: 'type must be one of error/install/update/import' }, { status: 400 });
  }

  const id = generateReportId();
  try {
    await saveReport(env, id, payload);
  } catch (e: any) {
    return json({ error: e?.message || 'save failed' }, { status: 500 });
  }
  return json({ ok: true, id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    if (url.pathname === '/report') {
      return handleReport(request, env);
    }

    if (url.pathname !== '/sync') {
      return json({ error: 'not found' }, { status: 404 });
    }
    const token = readToken(request, url);
    if (!TOKEN_RE.test(token)) {
      return json({ error: 'token must be 32 hex characters' }, { status: 400 });
    }

    if (request.method === 'GET') {
      try {
        return json(await loadState(env, token));
      } catch (e: any) {
        return json({ error: e?.message || 'state unreadable' }, { status: 500 });
      }
    }

    if (request.method === 'POST') {
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return json({ error: 'payload too large' }, { status: 413 });
      }
      let body: IncomingPayload;
      try {
        body = (await request.json()) as IncomingPayload;
      } catch {
        return json({ error: 'invalid json' }, { status: 400 });
      }
      let merged: UserState;
      try {
        merged = mergeInto(await loadState(env, token), body, Date.now());
      } catch (e: any) {
        // Refusing beats merging into a fresh state and overwriting whatever
        // is actually stored under this token.
        return json({ error: e?.message || 'state unreadable' }, { status: 500 });
      }
      try {
        await saveState(env, token, merged);
      } catch (e: any) {
        return json({ error: e?.message || 'save failed' }, { status: 500 });
      }
      return json(merged);
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  }
};
