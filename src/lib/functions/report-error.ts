const appVersion = __APP_VERSION__;

const REPORT_ENDPOINT = 'https://sync.fivood.com/report';

export type ReportType = 'error' | 'install' | 'update' | 'import';

export interface ReportPayload {
  type: ReportType;
  version?: string;
  currentVersion?: string;
  targetVersion?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  log?: unknown[];
  timestamp?: number;
  userAgent?: string;
  url?: string;
}

export async function submitReport(
  payload: ReportPayload
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const resp = await fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        version: payload.version ?? appVersion,
        timestamp: payload.timestamp ?? Date.now(),
        userAgent: payload.userAgent ?? navigator.userAgent,
        url: payload.url ?? (typeof window !== 'undefined' ? window.location.href : undefined)
      })
    });
    const data = (await resp.json().catch(() => ({ error: 'invalid response' }))) as {
      ok?: boolean;
      id?: string;
      error?: string;
    };
    if (!resp.ok) {
      return { ok: false, error: data.error ?? `HTTP ${resp.status}` };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
