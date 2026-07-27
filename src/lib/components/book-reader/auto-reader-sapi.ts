/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Windows system TTS engine. Rust side wraps WinRT SpeechSynthesizer (NOT
 * the `tts` crate, which only saw SAPI 5 voices and missed Windows 11's
 * Natural neural voices). Each sentence is synthesized to a WAV blob and
 * played by BlobAutoReader, which also handles the prefetch pipeline.
 */

import { BlobAutoReader } from './auto-reader-blob-base';

export class AutoReaderSapi extends BlobAutoReader {
  /** WinRT applies SetSpeakingRate during synthesis (see winrt_tts.rs), so
   *  the base class must not also touch audio.playbackRate. */
  protected readonly synthesisHonorsRate = true;

  protected async synthesize(text: string, rate: number): Promise<Blob> {
    const { invoke } = await import('@tauri-apps/api/core');
    const b64 = await invoke<string>('sapi_speak', {
      text,
      voiceId: this._voiceId || null,
      rate
    });

    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes as BlobPart], { type: 'audio/wav' });
  }
}
