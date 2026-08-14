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
// Growth caps. Without these a single token's blob can be inflated until it
// trips MAX_STATE_BYTES, at which point every later push for that user fails.
const MAX_BOOKS = 2000;
const MAX_DAYS_PER_BOOK = 800;
const MAX_CLIENTS_PER_DAY = 32;

interface DayEntry {
  /** Per-device daily totals; server keeps max(client-reported) per device. */
  clients: Record<string, number>;
  /** Server-side last update millis. */
  updatedAt: number;
}

interface UserState {
  /** Schema bump knob for future migrations. */
  v: 1;
  /** books[bookTitle][dateKey YYYY-MM-DD] = DayEntry */
  books: Record<string, Record<string, DayEntry>>;
}

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
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

function emptyState(): UserState {
  return { v: 1, books: {} };
}

async function loadState(env: Env, token: string): Promise<UserState> {
  const raw = await env.STATS.get(token);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && typeof parsed.books === 'object') {
      return parsed as UserState;
    }
  } catch {
    // corrupt blob → start fresh; the client's next push will rebuild
  }
  return emptyState();
}

async function saveState(env: Env, token: string, state: UserState): Promise<void> {
  const body = JSON.stringify(state);
  if (body.length > MAX_STATE_BYTES) {
    throw new Error('state too large');
  }
  await env.STATS.put(token, body);
}

interface IncomingPayload {
  books?: Record<string, Record<string, { clients?: Record<string, number> }>>;
}

function mergeInto(server: UserState, incoming: IncomingPayload, now: number): UserState {
  if (!incoming.books) return server;
  for (const [book, dates] of Object.entries(incoming.books)) {
    if (!book || typeof dates !== 'object' || dates === null) continue;
    let serverBook = server.books[book];
    if (!serverBook) {
      if (Object.keys(server.books).length >= MAX_BOOKS) continue;
      serverBook = {};
      server.books[book] = serverBook;
    }
    for (const [date, entry] of Object.entries(dates)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!entry || typeof entry !== 'object') continue;
      let day = serverBook[date];
      if (!day) {
        if (Object.keys(serverBook).length >= MAX_DAYS_PER_BOOK) continue;
        day = { clients: {}, updatedAt: now };
        serverBook[date] = day;
      }
      const incomingClients = entry.clients || {};
      let changed = false;
      for (const [clientId, sec] of Object.entries(incomingClients)) {
        if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) continue;
        const capped = Math.min(sec, 86400); // can't read more than 24h in a day
        const prior = day.clients[clientId] || 0;
        if (!prior && Object.keys(day.clients).length >= MAX_CLIENTS_PER_DAY) continue;
        if (capped > prior) {
          day.clients[clientId] = capped;
          changed = true;
        }
      }
      if (changed) day.updatedAt = now;
    }
  }
  return server;
}

/**
 * The token is the only credential, so it belongs in a header rather than the
 * query string, where it lands in every access log along the way. The query
 * parameter still works: clients older than 1.10.8 only know how to send it
 * that way, and they keep syncing until they update.
 */
function readToken(request: Request, url: URL): string {
  const auth = request.headers.get('authorization') || '';
  const bearer = /^bearer\s+(.+)$/i.exec(auth.trim());
  const raw = bearer ? bearer[1] : url.searchParams.get('token') || '';
  return raw.trim().toLowerCase();
}

/**
 * Read the body with a real ceiling. The old check trusted `content-length`,
 * which a chunked request simply omits.
 */
async function readBoundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('payload too large');
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
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
    if (url.pathname !== '/sync') {
      return json({ error: 'not found' }, { status: 404 });
    }
    const token = readToken(request, url);
    if (!TOKEN_RE.test(token)) {
      return json({ error: 'token must be 32 hex characters' }, { status: 400 });
    }

    if (request.method === 'GET') {
      const state = await loadState(env, token);
      return json(state);
    }

    if (request.method === 'POST') {
      let raw: string;
      try {
        raw = await readBoundedText(request);
      } catch {
        return json({ error: 'payload too large' }, { status: 413 });
      }
      let body: IncomingPayload;
      try {
        body = JSON.parse(raw) as IncomingPayload;
      } catch {
        return json({ error: 'invalid json' }, { status: 400 });
      }
      const state = await loadState(env, token);
      const merged = mergeInto(state, body, Date.now());
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
