/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Microsoft Edge's browser-integrated TTS, over its unofficial consumer WSS
 * endpoint. Free, no account, hundreds of neural voices — including the
 * Xiaoxiao / Yunxi / Yunyang zh-CN neural family and Nanami / Keita ja-JP,
 * which are the best free Chinese/Japanese options for a long-form reader.
 *
 * All protocol work — Sec-MS-GEC token, WebSocket, frame parsing, MP3
 * concat — lives in `src-tauri/src/edge_tts.rs`. From the frontend this is
 * a plain "text in, blob out" engine on the shared `BlobAutoReader`, so it
 * inherits the sentence prefetch pipeline (audible dead air went from
 * ~469ms to ~15ms in v1.21.0 measurements). Depth 2 because latency is a
 * network round-trip, not CPU on a single WASM thread like Kokoro.
 *
 * Rate is embedded in the SSML `<prosody rate="+N%">` on the Rust side, so
 * the frontend must NOT also touch `audio.playbackRate` — same rule that
 * caught WinRT SAPI back in v1.21.0.
 */

import { BlobAutoReader } from './auto-reader-blob-base';
import { ttsEdgeProxyUrl$, ttsEdgeVoiceId$ } from '$lib/data/store';

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

export class AutoReaderEdge extends BlobAutoReader {
  protected readonly engineKey = 'edge';

  protected legacyVoiceId() {
    return ttsEdgeVoiceId$.getValue();
  }

  protected readonly synthesisHonorsRate = true;

  protected prefetchDepth = 2;

  protected async synthesize(text: string, rate: number): Promise<Blob> {
    const { invoke } = await import('@tauri-apps/api/core');
    const voice = this._voiceId || DEFAULT_VOICE;
    const b64 = await invoke<string>('edge_tts_synthesize', {
      text,
      voice,
      rate,
      proxyUrl: ttsEdgeProxyUrl$.getValue() || null
    });

    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    // Edge returns MP3 (24kHz 48kbps mono) regardless of voice.
    return new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
  }
}
