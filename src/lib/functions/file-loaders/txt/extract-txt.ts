/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export default async function extract(file: File) {
  const buffer = await file.arrayBuffer();
  return decodeWithFallback(new Uint8Array(buffer));
}

function decodeWithFallback(bytes: Uint8Array): string {
  // BOM sniffing
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  // Strict UTF-8 (the only encoding we can prove via validity)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // fall through to heuristic detection
  }

  return detectAndDecode(bytes);
}

/**
 * Score each candidate decoding by CJK character density.
 * Japanese-only kana ranges strongly indicate Shift-JIS; otherwise the higher
 * Han-character density wins between GB18030 (Simplified) and BIG5 (Traditional).
 */
function detectAndDecode(bytes: Uint8Array): string {
  const sample = bytes.length > 65536 ? bytes.subarray(0, 65536) : bytes;
  const candidates: Array<'shift-jis' | 'gb18030' | 'big5'> = ['shift-jis', 'gb18030', 'big5'];

  let bestEncoding: (typeof candidates)[number] = 'gb18030';
  let bestScore = -Infinity;

  for (const enc of candidates) {
    let decoded: string;
    try {
      decoded = new TextDecoder(enc).decode(sample);
    } catch {
      continue;
    }
    const score = scoreText(decoded);
    if (score > bestScore) {
      bestScore = score;
      bestEncoding = enc;
    }
  }

  return new TextDecoder(bestEncoding).decode(bytes);
}

function scoreText(text: string): number {
  let han = 0;
  let kana = 0;
  let replacement = 0;
  let printable = 0;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    if (code === 0xfffd) {
      replacement += 1;
    } else if (code >= 0x3040 && code <= 0x30ff) {
      // Hiragana + Katakana — strong Japanese signal
      kana += 1;
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) // CJK Extension A
    ) {
      han += 1;
    } else if (code >= 0x20) {
      printable += 1;
    }
  }

  // Replacement chars are a strong negative; kana is a strong positive for JP.
  return han + kana * 5 - replacement * 10 + printable * 0.1;
}
