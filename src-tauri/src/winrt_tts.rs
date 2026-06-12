//! Windows system TTS via WinRT SpeechSynthesizer.
//!
//! We bypass the `tts` Rust crate because it only enumerates SAPI 5 voices,
//! which misses Windows 11's "Natural" neural voices (Xiaoxiao Natural HD,
//! Yunxi Natural, Nanami Natural, etc.) — exactly the voices we want users
//! to install for high-quality offline Chinese TTS.
//!
//! WinRT's `SpeechSynthesizer::AllVoices()` returns both classic SAPI 5
//! voices and Natural voices. Synthesis goes through
//! `SynthesizeTextToStreamAsync`, which yields a WAV-formatted IRandomAccess
//! Stream that we read fully into memory and base64-return so the frontend
//! can play it with HTMLAudioElement (same pattern as Edge).

use windows::{
  core::HSTRING,
  Media::SpeechSynthesis::{SpeechSynthesisStream, SpeechSynthesizer},
  Storage::Streams::DataReader,
};

#[derive(serde::Serialize, Clone)]
pub struct SapiVoice {
  pub id: String,
  pub name: String,
  pub language: String,
  pub gender: Option<String>,
}

pub fn list_voices() -> Result<Vec<SapiVoice>, String> {
  let voices = SpeechSynthesizer::AllVoices().map_err(|e| e.to_string())?;
  let count = voices.Size().map_err(|e| e.to_string())?;
  let mut out = Vec::with_capacity(count as usize);
  for i in 0..count {
    let v = voices.GetAt(i).map_err(|e| e.to_string())?;
    let id = v
      .Id()
      .map(|h| h.to_string_lossy())
      .unwrap_or_default();
    let name = v
      .DisplayName()
      .map(|h| h.to_string_lossy())
      .unwrap_or_default();
    let language = v
      .Language()
      .map(|h| h.to_string_lossy())
      .unwrap_or_default();
    let description = v
      .Description()
      .map(|h| h.to_string_lossy())
      .unwrap_or_default();
    let gender = v.Gender().ok().map(|g| format!("{g:?}"));
    // Surface Natural voices with a clearer label since their Description
    // typically already says "Microsoft Xiaoxiao Online (Natural)" etc.
    let name = if !description.is_empty() && description != name {
      description
    } else {
      name
    };
    out.push(SapiVoice { id, name, language, gender });
  }
  Ok(out)
}

pub fn synthesize_blocking(
  voice_id: Option<&str>,
  rate: f32,
  text: &str,
) -> Result<Vec<u8>, String> {
  let synth = SpeechSynthesizer::new().map_err(|e| e.to_string())?;

  // Voice selection: match by exact Id from AllVoices().
  if let Some(id) = voice_id.filter(|s| !s.is_empty()) {
    let voices = SpeechSynthesizer::AllVoices().map_err(|e| e.to_string())?;
    let count = voices.Size().map_err(|e| e.to_string())?;
    for i in 0..count {
      let v = voices.GetAt(i).map_err(|e| e.to_string())?;
      let v_id = v.Id().map(|h| h.to_string_lossy()).unwrap_or_default();
      if v_id == id {
        synth.SetVoice(&v).map_err(|e| e.to_string())?;
        break;
      }
    }
  }

  // Rate: WinRT SpeakingRate is multiplier (default 1.0, allowed 0.5..6.0).
  let rate = rate.clamp(0.5, 2.0);
  if let Ok(options) = synth.Options() {
    let _ = options.SetSpeakingRate(rate as f64);
  }

  let stream: SpeechSynthesisStream = synth
    .SynthesizeTextToStreamAsync(&HSTRING::from(text))
    .map_err(|e| e.to_string())?
    .get()
    .map_err(|e| e.to_string())?;

  let size = stream.Size().map_err(|e| e.to_string())? as u32;
  let reader = DataReader::CreateDataReader(&stream).map_err(|e| e.to_string())?;
  reader
    .LoadAsync(size)
    .map_err(|e| e.to_string())?
    .get()
    .map_err(|e| e.to_string())?;

  let mut buf = vec![0u8; size as usize];
  reader.ReadBytes(&mut buf).map_err(|e| e.to_string())?;
  Ok(buf)
}
