/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Custom HTTP TTS — sends each sentence to a user-configured endpoint and
 * plays the returned audio bytes. Settings live in tts(Custom)* stores; the
 * user fills URL, headers, body template and the Rust side handles the actual
 * HTTP call (so CORS / auth headers aren't a problem).
 *
 * Playback, position tracking and the prefetch pipeline live in
 * BlobAutoReader — a network round-trip per sentence is exactly the latency
 * that pipeline exists to hide, so this engine prefetches two ahead.
 */

import { BlobAutoReader } from './auto-reader-blob-base';
import {
  ttsCustomAudioPath$,
  ttsCustomBody$,
  ttsCustomEndpoint$,
  ttsCustomHeaders$,
  ttsCustomMethod$,
  ttsCustomProxyUrl$
} from '$lib/data/store';
import { wrapPcmAsWav } from '$lib/functions/pcm-to-wav';

export class AutoReaderCustom extends BlobAutoReader {
  /** Rate isn't part of the request contract (the body template is entirely
   *  user-authored), so the base class applies it via playbackRate. */
  protected readonly synthesisHonorsRate = false;

  /** Two sentences deep: HTTP latency is wall-clock, not CPU, so queuing an
   *  extra request doesn't compete with anything. */
  protected prefetchDepth = 2;

  protected canStart(): string | null {
    if (!ttsCustomEndpoint$.getValue().trim()) {
      return '请先在设置里填好自定义 TTS 端点';
    }
    try {
      const parsed = JSON.parse(ttsCustomHeaders$.getValue() || '{}');
      if (parsed && typeof parsed !== 'object') throw new Error('不是对象');
      if (Array.isArray(parsed)) throw new Error('不能是数组');
    } catch (err: any) {
      return `自定义 TTS 请求头不是合法 JSON: ${err.message}`;
    }
    return null;
  }

  protected async synthesize(text: string): Promise<Blob> {
    const endpoint = ttsCustomEndpoint$.getValue().trim();
    if (!endpoint) throw new Error('请先在设置里填好自定义 TTS 端点');

    let headersObj: Record<string, string> = {};
    const parsed = JSON.parse(ttsCustomHeaders$.getValue() || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      headersObj = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const b64 = await invoke<string>('custom_tts_synthesize', {
      endpoint,
      method: ttsCustomMethod$.getValue() || 'POST',
      headers: headersObj,
      bodyTemplate: ttsCustomBody$.getValue() || '',
      audioPath: ttsCustomAudioPath$.getValue() || null,
      proxyUrl: ttsCustomProxyUrl$.getValue() || null,
      text
    });

    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);

    // Gemini 2.5 Flash TTS returns headerless L16 PCM at 24kHz mono, which no
    // browser will play — slap a standard WAV header in front. Other engines
    // stream MP3 / WAV bytes that play out of the box.
    const audioPath = ttsCustomAudioPath$.getValue() || '';
    const isGeminiPcm =
      endpoint.includes('generativelanguage.googleapis.com') &&
      /inlineData\.data$/.test(audioPath);

    return isGeminiPcm
      ? wrapPcmAsWav(bytes, 24000, 16, 1)
      : new Blob([bytes as BlobPart], { type: 'audio/mpeg' });
  }
}
