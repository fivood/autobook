// Twin of the desktop sync client. Lives in mobile-typewriter so the PWA
// doesn't need to import across project boundaries; the wire protocol is
// owned by stats-sync/src/index.ts (the Cloudflare Worker).

export const SYNC_ENDPOINT = 'https://sync.fivood.com/sync';

export interface DayClients {
  clients: Record<string, number>;
  /** Per-device chars-read totals; absent when only pre-chars-sync clients
   * (this PWA before mid-2026, or older desktop builds) have reported for
   * this day. Merged server-side with the same max-by-device rule as
   * `clients`. */
  charsClients?: Record<string, number>;
  updatedAt?: number;
}
export interface RemoteState {
  v: 1;
  books: Record<string, Record<string, DayClients>>;
}

export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isValidToken(t: string): boolean {
  return /^[0-9a-f]{32}$/i.test(t);
}

export async function pullState(token: string, signal?: AbortSignal): Promise<RemoteState> {
  const res = await fetch(`${SYNC_ENDPOINT}?token=${token}`, { signal });
  if (!res.ok) throw new Error(`pull ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data || data.v !== 1) return { v: 1, books: {} };
  return data as RemoteState;
}

export async function pushDelta(
  token: string,
  payload: {
    books: Record<
      string,
      Record<
        string,
        {
          clients: Record<string, number>;
          charsClients?: Record<string, number>;
        }
      >
    >;
  },
  signal?: AbortSignal
): Promise<RemoteState> {
  const res = await fetch(`${SYNC_ENDPOINT}?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) throw new Error(`push ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RemoteState;
}
