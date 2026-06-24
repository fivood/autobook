// localStorage-backed reading positions, keyed by content hash so the same
// file resumes regardless of where the user re-uploaded it from.

const PREFIX = 'tw-book:';

export interface SavedPosition {
  title: string;
  revealed: number;
  total: number;
  updatedAt: number;
  preview: string;
  /** Optional cover image as data URL. Only EPUBs carry one currently. */
  coverDataUrl?: string;
}

export async function hashContent(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder().encode(text.slice(0, 32 * 1024));
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 5381;
  for (let i = 0; i < Math.min(text.length, 32 * 1024); i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function getPosition(hash: string): SavedPosition | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(PREFIX + hash);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedPosition;
  } catch {
    return null;
  }
}

export function savePosition(hash: string, pos: SavedPosition) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFIX + hash, JSON.stringify(pos));
}

export function listRecent(limit = 8): Array<SavedPosition & { hash: string }> {
  if (typeof localStorage === 'undefined') return [];
  const items: Array<SavedPosition & { hash: string }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k)!) as SavedPosition;
      items.push({ ...v, hash: k.slice(PREFIX.length) });
    } catch {
      // ignore
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items.slice(0, limit);
}

export function removePosition(hash: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PREFIX + hash);
}
