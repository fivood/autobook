/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Canonical client for the reading-time sync service (stats-sync/src/index.ts,
 * a Cloudflare Worker backed by KV). The desktop app and the mobile PWA are
 * separate SvelteKit projects that both talk to the same deployed endpoint, and
 * they used to keep a copy of this each. The copies had already drifted — the
 * desktop one validated tokens and reported HTTP status, the mobile one didn't
 * — which is exactly the failure mode you don't want in the piece of code that
 * has to agree with a live server. One file now, imported by both.
 *
 * Framework-free on purpose: no `$lib`, no `$app`, nothing either project owns.
 */

export const SYNC_ENDPOINT = 'https://sync.fivood.com/sync';

export interface DayClients {
  clients: Record<string, number>;
  updatedAt?: number;
}

export interface RemoteState {
  v: 1;
  books: Record<string, Record<string, DayClients>>;
}

export interface PushPayload {
  books: Record<string, Record<string, { clients: Record<string, number> }>>;
}

/** Carries the HTTP status so callers can tell "bad token" from "server down". */
export class SyncError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
  }
}

export function isValidToken(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}

export function generateToken(): string {
  return randomHex(16);
}

/** A per-install identifier so the server can attribute time to "this device". */
export function generateDeviceId(): string {
  return randomHex(8);
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The token is the whole credential, so it goes in the Authorization header
 * rather than the query string, where it would be recorded by every proxy and
 * access log on the way. The Worker still accepts `?token=` for clients that
 * haven't updated.
 */
function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function pullState(token: string, signal?: AbortSignal): Promise<RemoteState> {
  assertToken(token);
  const res = await fetch(SYNC_ENDPOINT, { headers: authHeaders(token), signal });
  if (!res.ok) {
    throw new SyncError(res.status, await safeMessage(res));
  }
  const data = (await res.json()) as RemoteState;
  if (!data || data.v !== 1 || typeof data.books !== 'object') {
    return { v: 1, books: {} };
  }
  return data;
}

export async function pushDelta(
  token: string,
  payload: PushPayload,
  signal?: AbortSignal
): Promise<RemoteState> {
  assertToken(token);
  const res = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    throw new SyncError(res.status, await safeMessage(res));
  }
  return (await res.json()) as RemoteState;
}

function assertToken(token: string) {
  if (!isValidToken(token)) {
    throw new SyncError(400, 'token 格式无效（应为 32 字符 hex）');
  }
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error) return String(parsed.error);
    } catch {
      // not json — fall through to the raw text
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
      for (const seconds of Object.values(clients)) total += seconds;
      out.push({ book, date, totalSeconds: total, clients });
    }
  }
  return out;
}
