// Cross-device reading-time sync client. Hits sync.fivood.com (a Cloudflare
// Worker backed by KV) with a user-owned 32-hex token. Every device picks its
// own UUID so the server can keep per-device daily contributions and clients
// can sum them when displaying.

const SYNC_ENDPOINT = 'https://sync.fivood.com/sync';

/**
 * A device's playback share of its own daily total — what the statistics page
 * splits into 朗读 / 打字机 / 手动.
 *
 * Optional at every level, and a missing split means "unknown", not "zero":
 * the PWA has no TTS and never sends one, and neither do desktop builds before
 * 1.47. Their time still lands in the totals; it just doesn't get attributed.
 */
export interface ModeTotals {
  ttsSeconds?: number;
  ttsChars?: number;
  twSeconds?: number;
  twChars?: number;
}

export interface DayClients {
  clients: Record<string, number>;
  /** Per-device chars-read totals; absent for entries only pushed by pre-v2
   * clients. Merged server-side with the same max-by-device rule. */
  charsClients?: Record<string, number>;
  /** modes[deviceId] = that device's playback split. Same max-by-device merge,
   * one field at a time. */
  modes?: Record<string, ModeTotals>;
  updatedAt?: number;
}

export interface RemoteState {
  v: 1;
  books: Record<string, Record<string, DayClients>>;
}

export interface SyncError {
  status: number;
  message: string;
}

function isValidToken(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A per-install identifier so the server can attribute time to "this device". */
export function generateDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The token is the entire credential, so it travels in a header — as a query
 * parameter it ends up in Cloudflare access logs, any intermediary's logs, and
 * `Referer` on anything the response links to.
 *
 * The worker still accepts `?token=` because older desktop builds and the PWA
 * (which ships from `release/1.6.0` on its own schedule) keep sending it, so
 * this change is safe to deploy in either order.
 */
function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function pullState(token: string, signal?: AbortSignal): Promise<RemoteState> {
  if (!isValidToken(token)) {
    throw { status: 400, message: 'token 格式无效（应为 32 字符 hex）' } satisfies SyncError;
  }
  const res = await fetch(SYNC_ENDPOINT, { headers: authHeader(token), signal });
  if (!res.ok) {
    throw { status: res.status, message: await safeMessage(res) } satisfies SyncError;
  }
  const data = (await res.json()) as RemoteState;
  if (!data || data.v !== 1 || typeof data.books !== 'object') {
    return { v: 1, books: {} };
  }
  return data;
}

export interface PushPayload {
  books: Record<
    string,
    Record<
      string,
      {
        clients: Record<string, number>;
        charsClients?: Record<string, number>;
        modes?: Record<string, ModeTotals>;
      }
    >
  >;
}

export async function pushDelta(
  token: string,
  payload: PushPayload,
  signal?: AbortSignal
): Promise<RemoteState> {
  if (!isValidToken(token)) {
    throw { status: 400, message: 'token 格式无效（应为 32 字符 hex）' } satisfies SyncError;
  }
  const res = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    throw { status: res.status, message: await safeMessage(res) } satisfies SyncError;
  }
  return (await res.json()) as RemoteState;
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      if (j?.error) return String(j.error);
    } catch {
      // not json
    }
    return body.slice(0, 200) || res.statusText;
  } catch {
    return res.statusText;
  }
}

export interface RemoteRow {
  book: string;
  date: string;
  totalSeconds: number;
  totalChars: number;
  clients: Record<string, number>;
  charsClients: Record<string, number>;
  modes: Record<string, ModeTotals>;
}

/** Convert remote state into a flat list of (book, date, sum-across-devices). */
export function flattenRemote(state: RemoteState): RemoteRow[] {
  const out: RemoteRow[] = [];
  for (const [book, dates] of Object.entries(state.books || {})) {
    for (const [date, entry] of Object.entries(dates || {})) {
      const clients = entry?.clients || {};
      const charsClients = entry?.charsClients || {};
      let totalSeconds = 0;
      for (const v of Object.values(clients)) totalSeconds += v;
      let totalChars = 0;
      for (const v of Object.values(charsClients)) totalChars += v;
      out.push({
        book,
        date,
        totalSeconds,
        totalChars,
        clients,
        charsClients,
        modes: entry?.modes || {}
      });
    }
  }
  return out;
}

/** Sum one field of the split across every device except `exceptDeviceId`. */
export function sumModeField(
  modes: Record<string, ModeTotals>,
  field: keyof ModeTotals,
  exceptDeviceId: string
): number {
  let total = 0;
  for (const [id, totals] of Object.entries(modes || {})) {
    if (id === exceptDeviceId) continue;
    total += totals?.[field] || 0;
  }
  return total;
}
