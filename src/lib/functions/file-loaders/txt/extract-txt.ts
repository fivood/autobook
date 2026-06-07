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

  // Try strict UTF-8 first
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // fall through
  }

  // Fall back to GB18030 (covers GBK / GB2312 / Simplified + Traditional Chinese)
  try {
    return new TextDecoder('gb18030').decode(bytes);
  } catch {
    // last resort: lossy UTF-8
    return new TextDecoder('utf-8').decode(bytes);
  }
}
