/**
 * LaMa inpainting via an IOPaint sidecar (M3).
 *
 * IOPaint serves `POST /api/v1/inpaint` which accepts base64 image + mask and
 * returns the inpainted image as a JPEG stream. We use it for the bubbles the
 * flat-fill stage (comic-inpaint.ts) skips — gradient / textured backgrounds,
 * SFX, lettering outside bubbles — where a median fill would look wrong but
 * LaMa reconstructs the surrounding artwork convincingly.
 *
 * The sidecar is optional: without a reachable endpoint the pipeline silently
 * falls back to the flat-fill result. A per-book flag (or settings) controls
 * the endpoint URL.
 */

/** Generate a white-on-black mask image for a set of bubbles (white = erase). */
function buildInpaintMask(
  width: number,
  height: number,
  bubbles: Array<{ poly: [number, number][] }>
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  for (const bubble of bubbles) {
    const xs = bubble.poly.map((p) => p[0]);
    const ys = bubble.poly.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(height, Math.ceil(Math.max(...ys)));
    if (x1 <= x0 || y1 <= y0) continue;
    // Expand slightly to cover the lettering outline.
    const ex = Math.max(2, Math.round((x1 - x0) * 0.08));
    const ey = Math.max(2, Math.round((y1 - y0) * 0.08));
    ctx.fillRect(Math.max(0, x0 - ex), Math.max(0, y0 - ey), Math.min(width, x1 + ex) - Math.max(0, x0 - ex), Math.min(height, y1 + ey) - Math.max(0, y0 - ey));
  }
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), 'image/png'));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface LamaResult {
  ok: boolean;
  /** Inpainted image blob when ok. */
  blob?: Blob;
  error?: string;
}

/**
 * Run LaMa inpainting over a page for the given bubbles. Returns the
 * inpainted image, or `{ ok: false }` when the sidecar is unreachable (the
 * caller falls back to the flat-fill result).
 */
export async function inpaintWithLama(
  pageBlob: Blob,
  bubbles: Array<{ poly: [number, number][] }>,
  endpoint: string
): Promise<LamaResult> {
  try {
    const base = endpoint.replace(/\/$/, '');
    // Decode page dims to build a matching mask.
    const bitmap = await createImageBitmap(pageBlob);
    const mask = await buildInpaintMask(bitmap.width, bitmap.height, bubbles);
    bitmap.close();

    const [imageB64, maskB64] = await Promise.all([blobToBase64(pageBlob), blobToBase64(mask)]);
    const res = await fetch(`${base}/api/v1/inpaint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: imageB64, mask: maskB64 })
    });
    if (!res.ok) return { ok: false, error: `LaMa HTTP ${res.status}` };
    const blob = await res.blob();
    if (!blob.size) return { ok: false, error: 'LaMa returned empty result' };
    return { ok: true, blob };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function isLamaReachable(endpoint: string): Promise<boolean> {
  try {
    const base = endpoint.replace(/\/$/, '');
    const res = await fetch(`${base}/api/v1/server-config`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
