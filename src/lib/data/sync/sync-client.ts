// Cross-device reading-time sync client. Hits sync.fivood.com (a Cloudflare
// Worker backed by KV) with a user-owned 32-hex token. Every device picks its
// own UUID so the server can keep per-device daily contributions and clients
// can sum them when displaying.

export const SYNC_ENDPOINT = 'https://sync.fivood.com/sync';

export interface DayClients {
  clients: Record<string, number>;
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

export async function pullState(token: string, signal?: AbortSignal): Promise<RemoteState> {
  if (!isValidToken(token)) {
    throw { status: 400, message: 'token 格式无效（应为 32 字符 hex）' } satisfies SyncError;
  }
  const res = await fetch(`${SYNC_ENDPOINT}?token=${token}`, { signal });
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
  books: Record<string, Record<string, { clients: Record<string, number> }>>;
}

export async function pushDelta(
  token: string,
  payload: PushPayload,
  signal?: AbortSignal
): Promise<RemoteState> {
  if (!isValidToken(token)) {
    throw { status: 400, message: 'token 格式无效（应为 32 字符 hex）' } satisfies SyncError;
  }
  const res = await fetch(`${SYNC_ENDPOINT}?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

/** Convert remote state into a flat list of (book, date, sum-across-devices). */
export function flattenRemote(state: RemoteState): Array<{
  book: string;
  date: string;
  totalSeconds: number;
  clients: Record<string, number>;
}> {
  const out: Array<{
    book: string;
    date: string;
    totalSeconds: number;
    clients: Record<string, number>;
  }> = [];
  for (const [book, dates] of Object.entries(state.books || {})) {
    for (const [date, entry] of Object.entries(dates || {})) {
      const clients = entry?.clients || {};
      let total = 0;
      for (const v of Object.values(clients)) total += v;
      out.push({ book, date, totalSeconds: total, clients });
    }
  }
  return out;
}
