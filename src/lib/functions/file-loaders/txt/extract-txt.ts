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
 * Decode bytes that are not UTF-8: Korean (EUC-KR / CP949) first, then score
 * each remaining candidate by CJK character density. Japanese-only kana ranges
 * strongly indicate Shift-JIS; otherwise the higher Han-character density wins
 * between GB18030 (Simplified) and BIG5 (Traditional).
 */
export function detectAndDecode(bytes: Uint8Array): string {
  const sample = bytes.length > 65536 ? bytes.subarray(0, 65536) : bytes;

  // Korean never made the candidate list, so a CP949 TXT — the usual encoding
  // of Korean text files — came out as GB18030 gibberish. It can't just join
  // the Han-density race below: GB18030 decodes Korean bytes into valid Han
  // characters, and GBK Chinese decodes as EUC-KR into valid Hangul syllables.
  try {
    if (looksKorean(new TextDecoder('euc-kr').decode(sample))) {
      return new TextDecoder('euc-kr').decode(bytes);
    }
  } catch {
    // no euc-kr decoder in this runtime: fall back to the CJK candidates
  }
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

// The syllables that carry Korean grammar (particles, endings, 이다/하다).
// In real Korean text these are roughly a third of all syllables; Chinese or
// Japanese bytes misread as EUC-KR spread over the ~2,350 KS X 1001 syllables
// and hit this set only a percent or two of the time.
const COMMON_HANGUL = new Set([...'이다는의에가을를하고지서로한으도기있사들것그리나수인해었았게요까니면']);

function looksKorean(text: string): boolean {
  let hangul = 0;
  let common = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      hangul += 1;
      if (COMMON_HANGUL.has(ch)) common += 1;
    }
  }
  return hangul >= 10 && common / hangul >= 0.12;
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
