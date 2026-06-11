//! Edge online TTS client — speaks SSML to speech.platform.bing.com via
//! WebSocket and returns the resulting MP3 bytes.
//!
//! Protocol notes (the upstream is unofficial / community-reverse-engineered;
//! Microsoft has tightened auth twice since 2024, so expect periodic drift):
//!
//! - Endpoint: wss://speech.platform.bing.com/consumer/speech/synthesize
//!             /readaloud/edge/v1?TrustedClientToken=…
//! - Auth headers: Sec-MS-GEC (SHA-256 of ticks||token) + Sec-MS-GEC-Version.
//!   GEC token rotates every 5 minutes.
//! - First message: `speech.config` (JSON) declaring the desired audio format.
//! - Second message: `ssml` (SSML body wrapping voice + prosody rate).
//! - Server streams binary frames: 2-byte BE header length, ASCII headers,
//!   then raw MP3 chunks. Final text frame has `Path:turn.end`.

use base64::{engine::general_purpose, Engine};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use tokio_tungstenite::tungstenite::{
  client::IntoClientRequest,
  http::{HeaderValue, Request},
  Message,
};

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const GEC_VERSION: &str = "1-131.0.2903.99";
const EDGE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const AUDIO_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

/// Win32 FILETIME epoch (1601-01-01) vs Unix epoch, in 100-nanosecond ticks.
const WIN_EPOCH_TICKS: i64 = 11_644_473_600 * 10_000_000;

fn gec_token() -> String {
  let ts_secs = Utc::now().timestamp();
  // Round down to the nearest 5 minutes — the server expects a quantized
  // timestamp to keep the hash stable across the ~RTT of a request.
  let bucket = ts_secs - (ts_secs % 300);
  let ticks = bucket * 10_000_000 + WIN_EPOCH_TICKS;
  let raw = format!("{ticks}{TRUSTED_CLIENT_TOKEN}");
  let mut hasher = Sha256::new();
  hasher.update(raw.as_bytes());
  format!("{:X}", hasher.finalize())
}

fn now_iso() -> String {
  Utc::now()
    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
    .to_string()
}

fn build_config_message(request_id: &str) -> String {
  let body = format!(
    "{{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\
        \"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"\
      }},\"outputFormat\":\"{AUDIO_FORMAT}\"}}}}}}}}"
  );
  format!(
    "X-Timestamp:{ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\nX-RequestId:{request_id}\r\n\r\n{body}",
    ts = now_iso(),
    request_id = request_id,
    body = body,
  )
}

/// Build the SSML payload framed in an EdgeTTS protocol message.
fn build_ssml_message(request_id: &str, voice: &str, rate: f32, text: &str) -> String {
  let escaped = text
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;");
  let rate_pct = ((rate - 1.0) * 100.0).round() as i32;
  let rate_str = if rate_pct >= 0 {
    format!("+{rate_pct}%")
  } else {
    format!("{rate_pct}%")
  };
  let ssml = format!(
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
     <voice name='{voice}'>\
     <prosody pitch='+0Hz' rate='{rate_str}' volume='+0%'>{escaped}</prosody>\
     </voice></speak>"
  );
  format!(
    "X-Timestamp:{ts}\r\nX-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n{ssml}",
    ts = now_iso()
  )
}

/// Strip the per-frame header from a binary audio chunk, returning the raw MP3 payload.
fn strip_audio_header(frame: &[u8]) -> Option<&[u8]> {
  if frame.len() < 2 {
    return None;
  }
  let header_len = u16::from_be_bytes([frame[0], frame[1]]) as usize;
  if 2 + header_len > frame.len() {
    return None;
  }
  let body = &frame[2 + header_len..];
  Some(body)
}

pub async fn synthesize(voice: &str, rate: f32, text: &str) -> Result<Vec<u8>, String> {
  let url = format!(
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={TRUSTED_CLIENT_TOKEN}"
  );

  let mut request: Request<()> = url.into_client_request().map_err(|e| e.to_string())?;
  let headers = request.headers_mut();
  let gec = gec_token();
  // Header set matches what the Python edge-tts client sends — Microsoft
  // appears to gate 403 partly on Cache-Control/Pragma/Accept-* presence.
  headers.insert("Sec-MS-GEC", HeaderValue::from_str(&gec).map_err(|e| e.to_string())?);
  headers.insert("Sec-MS-GEC-Version", HeaderValue::from_static(GEC_VERSION));
  headers.insert("User-Agent", HeaderValue::from_static(EDGE_UA));
  headers.insert(
    "Origin",
    HeaderValue::from_static("chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"),
  );
  headers.insert("Pragma", HeaderValue::from_static("no-cache"));
  headers.insert("Cache-Control", HeaderValue::from_static("no-cache"));
  headers.insert("Accept-Encoding", HeaderValue::from_static("gzip, deflate, br"));
  headers.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));

  let (ws, _resp) = tokio_tungstenite::connect_async(request)
    .await
    .map_err(|e| format!("WebSocket connect failed: {e}"))?;

  let (mut tx, mut rx) = ws.split();

  let request_id = uuid::Uuid::new_v4().simple().to_string();
  tx.send(Message::Text(build_config_message(&request_id)))
    .await
    .map_err(|e| e.to_string())?;
  tx.send(Message::Text(build_ssml_message(&request_id, voice, rate, text)))
    .await
    .map_err(|e| e.to_string())?;

  let mut audio = Vec::<u8>::new();
  let timeout = tokio::time::Duration::from_secs(30);

  loop {
    let frame = tokio::time::timeout(timeout, rx.next())
      .await
      .map_err(|_| "Edge TTS timed out".to_string())?;
    let msg = match frame {
      Some(Ok(m)) => m,
      Some(Err(e)) => return Err(format!("WebSocket error: {e}")),
      None => return Err("WebSocket closed before audio finished".to_string()),
    };

    match msg {
      Message::Binary(bytes) => {
        if let Some(body) = strip_audio_header(&bytes) {
          audio.extend_from_slice(body);
        }
      }
      Message::Text(text) => {
        if text.contains("Path:turn.end") {
          break;
        }
      }
      Message::Close(_) => break,
      _ => {}
    }
  }

  let _ = tx.close().await;

  if audio.is_empty() {
    return Err("Edge TTS returned no audio".to_string());
  }
  Ok(audio)
}

pub fn voices() -> Vec<EdgeVoice> {
  // Curated short list of the most useful voices per language. The full Edge
  // catalogue is ~300 voices but most are duplicates of system Neural voices
  // in obscure locales. This list balances zh-CN coverage with restraint.
  fn v(id: &str, name: &str, lang: &str, gender: &str) -> EdgeVoice {
    EdgeVoice {
      id: id.into(),
      name: name.into(),
      language: lang.into(),
      gender: gender.into(),
    }
  }
  vec![
    v("zh-CN-XiaoxiaoNeural", "晓晓（女）", "zh-CN", "Female"),
    v("zh-CN-XiaoyiNeural", "晓伊（女）", "zh-CN", "Female"),
    v("zh-CN-YunxiNeural", "云希（男）", "zh-CN", "Male"),
    v("zh-CN-YunyangNeural", "云扬（男）", "zh-CN", "Male"),
    v("zh-CN-YunjianNeural", "云健（男）", "zh-CN", "Male"),
    v("zh-CN-YunxiaNeural", "云夏（男）", "zh-CN", "Male"),
    v(
      "zh-CN-liaoning-XiaobeiNeural",
      "晓北（女，东北话）",
      "zh-CN-liaoning",
      "Female",
    ),
    v(
      "zh-CN-shaanxi-XiaoniNeural",
      "晓妮（女，陕西话）",
      "zh-CN-shaanxi",
      "Female",
    ),
    v("zh-HK-HiuMaanNeural", "曉曼（女，粤语）", "zh-HK", "Female"),
    v("zh-HK-WanLungNeural", "云龍（男，粤语）", "zh-HK", "Male"),
    v("zh-TW-HsiaoChenNeural", "曉臻（女，台湾）", "zh-TW", "Female"),
    v("zh-TW-YunJheNeural", "雲哲（男，台湾）", "zh-TW", "Male"),
    v("ja-JP-NanamiNeural", "Nanami（女）", "ja-JP", "Female"),
    v("ja-JP-KeitaNeural", "Keita（男）", "ja-JP", "Male"),
    v("en-US-AvaNeural", "Ava (Female)", "en-US", "Female"),
    v("en-US-AndrewNeural", "Andrew (Male)", "en-US", "Male"),
    v("en-US-AriaNeural", "Aria (Female)", "en-US", "Female"),
    v("en-US-GuyNeural", "Guy (Male)", "en-US", "Male"),
    v("en-GB-SoniaNeural", "Sonia (UK Female)", "en-GB", "Female"),
    v("en-GB-RyanNeural", "Ryan (UK Male)", "en-GB", "Male"),
  ]
}

#[derive(serde::Serialize, Clone)]
pub struct EdgeVoice {
  pub id: String,
  pub name: String,
  pub language: String,
  pub gender: String,
}
