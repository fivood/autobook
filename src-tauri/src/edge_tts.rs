//! Microsoft Edge's browser-integrated text-to-speech, over its unofficial
//! consumer WSS endpoint at `speech.platform.bing.com`. Same protocol Edge's
//! own "Read Aloud" feature uses. Free, no account, hundreds of neural
//! voices — Chinese (Xiaoxiao / Yunxi / Yunyang etc.) and Japanese
//! (Nanami / Keita) both first-class.
//!
//! Wire format is a small state machine over one WebSocket per synthesis:
//!   1. Text frame with `Path: speech.config` — audio metadata options
//!   2. Text frame with `Path: ssml` — the request itself
//!   3. Stream of binary frames, each `[2-byte BE header length][UTF-8
//!      headers][MP3 chunk]`, followed by a text frame with `Path: turn.end`
//!
//! We concatenate every chunk into one MP3 blob and hand it back to the
//! frontend as base64, matching `sapi_speak` and `custom_tts_synthesize` so
//! the shared `BlobAutoReader` prefetch pipeline works unchanged.
//!
//! Auth is a rotating `Sec-MS-GEC` header: SHA-256 of a Windows filetime
//! rounded to 5 minutes concatenated with a hard-coded client token
//! (extracted from Edge; not a secret Microsoft protects). Reverse-engineered
//! by rany2/edge-tts; nothing here is novel.

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL_BASE: &str =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
// Kept in lockstep with rany2/edge-tts's `SEC_MS_GEC_VERSION` so the server
// treats us as the same well-known client. Bump when they bump.
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
// Delta between Windows filetime (1601-01-01) and Unix epoch (1970-01-01),
// in seconds. Used to convert `SystemTime::now()` back to the tick space
// the server expects for token generation.
const WIN_EPOCH_TO_UNIX_EPOCH_SECS: u64 = 11_644_473_600;

/// Compute the `Sec-MS-GEC` query token as specified by
/// rany2/edge-tts#issue-290. The server accepts any token generated with a
/// timestamp within a ~10 minute window; rounding to 5 minutes gives ~5
/// minutes of budget while still cycling through fresh values.
fn sec_ms_gec_token() -> String {
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let win_seconds = now_unix + WIN_EPOCH_TO_UNIX_EPOCH_SECS;
    let rounded = win_seconds - (win_seconds % 300);
    // 100-ns intervals since the Windows epoch — filetime ticks.
    let ticks: u64 = rounded * 10_000_000;
    let to_hash = format!("{ticks}{TRUSTED_CLIENT_TOKEN}");
    let digest = Sha256::digest(to_hash.as_bytes());
    let mut out = String::with_capacity(64);
    for b in digest {
        // hex, uppercased inline to avoid a second allocation
        out.push_str(&format!("{b:02X}"));
    }
    out
}

/// Escape user text for SSML. Only `& < >` need swapping — quotes appear in
/// attributes we own, not in the character data slot.
fn escape_ssml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Rate value for SSML `<prosody rate="...">`. Edge expects a signed
/// percentage delta like `+0%` or `-25%` (not the OpenAI-style 0.5..2 multi-
/// plier the base class uses), so translate.
fn rate_ssml(rate: f32) -> String {
    let clamped = rate.clamp(0.5, 2.0);
    let delta_pct = ((clamped - 1.0) * 100.0).round() as i32;
    if delta_pct >= 0 {
        format!("+{delta_pct}%")
    } else {
        format!("{delta_pct}%")
    }
}

/// Split a binary frame at its embedded UTF-8 header block.
///
/// Layout is `[u16 BE header_len][header_len bytes of headers][audio bytes]`
/// where headers are Path: / Content-Type: separated by CRLF.
fn split_binary_frame(data: &[u8]) -> Option<(&str, &[u8])> {
    if data.len() < 2 {
        return None;
    }
    let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
    let start = 2usize;
    let end = start.checked_add(header_len)?;
    if end > data.len() {
        return None;
    }
    let headers = std::str::from_utf8(&data[start..end]).ok()?;
    Some((headers, &data[end..]))
}

/// Whether a text frame is the terminal `turn.end` marker.
fn is_turn_end(text: &str) -> bool {
    text.lines().any(|line| line.eq_ignore_ascii_case("Path:turn.end"))
}

/// Whether a binary frame's headers indicate the payload is MP3 audio.
fn is_audio_frame(headers: &str) -> bool {
    let mut path_audio = false;
    let mut content_ok = true;
    for line in headers.lines() {
        if let Some(rest) = line.strip_prefix("Path:") {
            if rest.trim().eq_ignore_ascii_case("audio") {
                path_audio = true;
            }
        } else if let Some(rest) = line.strip_prefix("Content-Type:") {
            let v = rest.trim();
            content_ok = v.is_empty() || v.eq_ignore_ascii_case("audio/mpeg");
        }
    }
    path_audio && content_ok
}

#[tauri::command]
pub async fn edge_tts_synthesize(
    text: String,
    voice: Option<String>,
    rate: Option<f32>,
) -> Result<String, String> {
    let voice = voice.unwrap_or_else(|| "en-US-EmmaMultilingualNeural".to_string());
    let rate = rate.unwrap_or(1.0);

    let connection_id = uuid::Uuid::new_v4().simple().to_string();
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let token = sec_ms_gec_token();
    let url = format!(
        "{WSS_URL_BASE}?TrustedClientToken={TRUSTED_CLIENT_TOKEN}\
         &ConnectionId={connection_id}\
         &Sec-MS-GEC={token}\
         &Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    );

    // Headers Edge itself sends; the server accepts other UAs but a few of
    // these (Origin, Cache-Control) are actually checked.
    let mut req = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("edge-tts URL: {e}"))?;
    {
        let h = req.headers_mut();
        h.insert(
            "Pragma",
            "no-cache".parse().map_err(|_| "hdr Pragma".to_string())?,
        );
        h.insert(
            "Cache-Control",
            "no-cache"
                .parse()
                .map_err(|_| "hdr Cache-Control".to_string())?,
        );
        h.insert(
            "Origin",
            "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
                .parse()
                .map_err(|_| "hdr Origin".to_string())?,
        );
        h.insert(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
                .parse()
                .map_err(|_| "hdr UA".to_string())?,
        );
    }

    let (mut ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("edge-tts connect: {e}"))?;

    // Frame 1: audio config. `outputFormat` is the only field the frontend
    // decodes directly, so keep it at plain MP3 rather than the smaller Opus
    // variants — the HTMLAudioElement path we play through decodes MP3
    // everywhere without codec surprises.
    let config_frame = format!(
        "X-Timestamp:{ts}\r\n\
         Content-Type:application/json; charset=utf-8\r\n\
         Path:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":\
         {{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}\r\n",
        ts = date_string()
    );
    ws.send(Message::Text(config_frame))
        .await
        .map_err(|e| format!("edge-tts config send: {e}"))?;

    // Frame 2: SSML with the actual text.
    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{voice}'>\
         <prosody pitch='+0Hz' rate='{rate}' volume='+0%'>{text}</prosody>\
         </voice></speak>",
        voice = voice,
        rate = rate_ssml(rate),
        text = escape_ssml(&text),
    );
    let ssml_frame = format!(
        "X-RequestId:{request_id}\r\n\
         Content-Type:application/ssml+xml\r\n\
         X-Timestamp:{ts}Z\r\n\
         Path:ssml\r\n\r\n\
         {ssml}",
        ts = date_string()
    );
    ws.send(Message::Text(ssml_frame))
        .await
        .map_err(|e| format!("edge-tts ssml send: {e}"))?;

    // Concat every audio chunk. MP3 concatenation is a byte-level operation
    // (frames self-sync), so no re-mux is needed.
    let mut audio: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(msg) = ws.next().await {
        let msg = msg.map_err(|e| format!("edge-tts recv: {e}"))?;
        match msg {
            Message::Text(t) => {
                if is_turn_end(&t) {
                    break;
                }
                // Other text frames (turn.start, response, audio.metadata)
                // aren't fatal — just skip; the terminator is turn.end.
            }
            Message::Binary(data) => {
                let Some((headers, body)) = split_binary_frame(&data) else {
                    continue;
                };
                if !is_audio_frame(headers) || body.is_empty() {
                    continue;
                }
                audio.extend_from_slice(body);
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    // Best-effort close — server may already have hung up after turn.end.
    let _ = ws.close(None).await;

    if audio.is_empty() {
        return Err("edge-tts 未收到任何音频，检查网络或音色名".to_string());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&audio))
}

/// Edge-flavored timestamp for the `X-Timestamp` frame headers. Format is
/// what Chrome's `Date().toString()` produces — the server tolerates
/// deviations but rany2's implementation matches this exactly.
fn date_string() -> String {
    // Second-precision UTC as "Day Mon DD YYYY HH:MM:SS GMT+0000".
    // Avoiding a `chrono` dep — this string is server-side unparsed and only
    // used for logging/telemetry on their end.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compute UTC broken-down time without pulling chrono. std doesn't
    // expose gmtime, so do it manually — this arithmetic is short and does
    // not have to handle leap seconds or timezone changes.
    let days_since_epoch = (secs / 86_400) as i64;
    let secs_of_day = (secs % 86_400) as u32;
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;

    // Civil-from-days (Howard Hinnant), same algorithm chrono uses.
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    const DAY_NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTH_NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    // Zeller-friendly: 1970-01-01 was a Thursday (index 3 with Mon=0).
    let dow = ((days_since_epoch % 7 + 7 + 3) % 7) as usize;

    format!(
        "{dn} {mn} {d:02} {year} {hh:02}:{mm:02}:{ss:02} GMT+0000 (Coordinated Universal Time)",
        dn = DAY_NAMES[dow],
        mn = MONTH_NAMES[(m - 1) as usize]
    )
}
