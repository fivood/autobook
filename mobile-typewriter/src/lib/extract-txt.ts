// Decode an uploaded text file. BOM sniffing first, then strict UTF-8, then
// score-based fallback between Shift-JIS / GB18030 / BIG5 by CJK density.
// Lifted from autopage's TXT loader so phone reading handles legacy encodings
// (国产 .txt 多数是 GBK/GB18030 而非 UTF-8).

export async function extractTxt(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return decodeWithFallback(new Uint8Array(buffer));
}

function decodeWithFallback(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // fall through
  }
  return detectAndDecode(bytes);
}

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
    if (code === 0xfffd) replacement += 1;
    else if (code >= 0x3040 && code <= 0x30ff) kana += 1;
    else if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) han += 1;
    else if (code >= 0x20) printable += 1;
  }
  return han + kana * 5 - replacement * 10 + printable * 0.1;
}
