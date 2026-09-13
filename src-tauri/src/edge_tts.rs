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

/// Whether a failure is worth another attempt. Proxy chains fail this way a
/// lot: Clash answers CONNECT with 200 *before* dialing upstream, so a dead
/// upstream node surfaces as the tunnel closing mid-TLS rather than as a
/// proxy-level error — indistinguishable from a real handshake failure at
/// this layer. Auth mistakes and bad voice names are permanent and must fail
/// immediately, or a typo'd voice would stall for the whole retry budget.
fn is_transient(err: &str) -> bool {
    // Lowercase literals so the comparison is a plain `contains`. Note the
    // rustls mid-stream wording is "closed connection", not "connection
    // closed" — matching only the latter silently skipped the retry.
    const MARKERS: [&str; 10] = [
        "handshake eof",
        "unexpectedeof",
        "unexpected eof",
        "close_notify",
        "closed connection",
        "connection closed",
        "reset by peer",
        "os error 10054",
        "代理在返回 connect 响应前关闭了连接",
        "无响应",
    ];
    let lowered = err.to_ascii_lowercase();
    MARKERS.iter().any(|m| lowered.contains(m))
}

#[cfg(test)]
mod transient_tests {
    use super::is_transient;

    #[test]
    fn matches_observed_proxy_failure_modes() {
        assert!(is_transient("edge-tts connect: IO error: tls handshake eof"));
        assert!(is_transient(
            "edge-tts recv: IO error: peer closed connection without sending TLS close_notify"
        ));
        assert!(is_transient("os error 10054"));
    }

    #[test]
    fn stalls_count_as_transient_so_the_retry_budget_applies() {
        // A silent stall is the same class of proxy failure as a mid-TLS
        // reset; if it did not match, the timeout would surface as a hard
        // error and skip all five attempts.
        assert!(is_transient("edge-tts 等待音频帧无响应（20s）"));
        assert!(is_transient("edge-tts 直连握手无响应（20s）"));
    }

    #[test]
    fn leaves_permanent_failures_alone() {
        assert!(!is_transient("edge-tts 未收到任何音频，检查网络或音色名"));
        assert!(!is_transient("代理拒绝 CONNECT: HTTP/1.1 407 Proxy Authentication Required"));
        assert!(!is_transient("不支持的代理协议: ftp"));
    }
}

#[tauri::command]
pub async fn edge_tts_synthesize(
    text: String,
    voice: Option<String>,
    rate: Option<f32>,
    proxy_url: Option<String>,
) -> Result<String, String> {
    // Proxy outages come in bursts lasting seconds, so the retry budget has to
    // outlast one. Measured over 10 sentences on a mainland Clash setup:
    // 3 attempts (1.2s of backoff) got 5/10, 5 attempts (4s) got 9/10. Worst
    // observed success took 5.7s, which `prefetchDepth = 2` hides while the
    // previous sentence is still playing.
    const ATTEMPTS: u32 = 5;
    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        // synthesize_once mints a fresh ConnectionId / X-RequestId each call;
        // reusing one after a half-open tunnel confuses the server's dedup.
        match synthesize_once(&text, voice.as_deref(), rate, proxy_url.as_deref()).await {
            Ok(audio) => return Ok(audio),
            Err(e) if is_transient(&e) => {
                last = e;
                if attempt + 1 < ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        400 * (attempt as u64 + 1),
                    ))
                    .await;
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err(format!("{last}\n（已重试 {ATTEMPTS} 次仍失败）"))
}

async fn synthesize_once(
    text: &str,
    voice: Option<&str>,
    rate: Option<f32>,
    proxy_url: Option<&str>,
) -> Result<String, String> {
    let voice = voice
        .map(str::to_string)
        .unwrap_or_else(|| "en-US-EmmaMultilingualNeural".to_string());
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

    // `connect_async` ignores every proxy setting and dials the host directly,
    // which is dead on any network that only reaches Bing through a proxy —
    // the TCP connect succeeds and the TLS handshake then EOFs. Tunnel via
    // CONNECT whenever a proxy is configured or auto-detected.
    // Every await below is bounded. A half-open tunnel — the failure mode this
    // whole module is built around — does not raise an error, it just stops
    // producing bytes, and an unbounded await on it hangs that sentence
    // forever: the retry budget never gets a chance to run, playback stops
    // dead, and neither layer above has a timeout of its own to notice.
    const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
    // Chunks stream continuously once synthesis starts; the only real wait is
    // before the first one.
    const FRAME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

    let proxy = crate::proxy::resolve(proxy_url);
    let (mut ws, _) = match &proxy {
        Some(p) => {
            let tcp = crate::proxy::connect_tunnel(p, "speech.platform.bing.com", 443).await?;
            tokio::time::timeout(
                CONNECT_TIMEOUT,
                tokio_tungstenite::client_async_tls_with_config(req, tcp, None, None),
            )
            .await
            .map_err(|_| format!("edge-tts 经代理 {p} 握手无响应（{}s）", CONNECT_TIMEOUT.as_secs()))?
                .map_err(|e| {
                    // The tunnel opened but died during TLS, so the local
                    // client is fine and the failure is past it. By far the
                    // most common cause is not a dead node but the proxy's own
                    // routing: mainstream Clash rulesets match bing.com into a
                    // "Microsoft" group whose default pick is DIRECT, so the
                    // request gets dialed straight out again and blocked.
                    format!(
                        "edge-tts connect (经代理 {p}): {e}\n\
                         代理已接受 CONNECT 但链路随即断开。最常见的原因不是节点故障，\
                         而是代理软件把该域名判给了直连：主流 Clash 规则集会把 bing.com \
                         归到「Ⓜ️ Microsoft」分组，而该分组默认选中「全球直连」，于是请求又被直接发出去。\n\
                         修法：在代理软件里把该分组改选为可用节点，或单独加一条规则 —— \
                         DOMAIN-SUFFIX,speech.platform.bing.com,<你的节点分组>（只放行朗读，\
                         Windows Update / Office 仍走直连）。"
                    )
                })?
        }
        None => tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(req))
            .await
            .map_err(|_| format!("edge-tts 直连握手无响应（{}s）", CONNECT_TIMEOUT.as_secs()))?
            .map_err(|e| {
            format!(
                "edge-tts connect: {e}\n\
                 直连 speech.platform.bing.com 失败。若在中国大陆，该域名通常需要代理才能访问 —— \
                 请在「设置 → 阅读 → Edge TTS」里填写代理地址（如 http://127.0.0.1:7897）。"
            )
        })?,
    };

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
        text = escape_ssml(text),
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
    loop {
        let Some(msg) = tokio::time::timeout(FRAME_TIMEOUT, ws.next())
            .await
            .map_err(|_| format!("edge-tts 等待音频帧无响应（{}s）", FRAME_TIMEOUT.as_secs()))?
        else {
            break;
        };
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

#[cfg(test)]
mod stall_tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Takes ~20s by design (one CONNECT_TIMEOUT), so it is `#[ignore]`d:
    /// `cargo test --lib stall_tests -- --ignored --nocapture`
    ///
    /// Stands in for the failure this bound exists for — a proxy that accepts
    /// CONNECT and then never speaks again. Before the timeout this hung
    /// forever, taking the sentence and the whole retry budget with it.
    #[tokio::test]
    #[ignore]
    async fn a_silent_proxy_times_out_instead_of_hanging() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock
                    .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await;
                // Then go silent, holding the socket open.
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            }
        });

        let started = std::time::Instant::now();
        let err = super::synthesize_once(
            "测试",
            Some("zh-CN-XiaoxiaoNeural"),
            Some(1.0),
            Some(&format!("http://{addr}")),
        )
        .await
        .unwrap_err();
        let elapsed = started.elapsed();
        println!("failed after {:?}: {}", elapsed, err.lines().next().unwrap_or(""));
        assert!(err.contains("无响应"), "unexpected error: {err}");
        assert!(elapsed < std::time::Duration::from_secs(40), "took {elapsed:?}");
        assert!(super::is_transient(&err), "should be retried: {err}");
    }
}

#[cfg(test)]
mod live_tests {
    /// Network-dependent. Run with:
    /// `cargo test --lib edge_tts::live_tests -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn measures_success_rate() {
        println!("proxy = {:?}", crate::proxy::resolve(None));
        let n = 10;
        let mut ok = 0;
        for i in 0..n {
            let t = std::time::Instant::now();
            match super::edge_tts_synthesize(
                format!("第{}句，连通性测试。", i + 1),
                Some("zh-CN-XiaoxiaoNeural".to_string()),
                Some(1.0),
                None,
            )
            .await
            {
                Ok(b) => {
                    ok += 1;
                    println!("  #{:<2} OK   {:>7.0}ms  {} bytes", i + 1, t.elapsed().as_millis(), b.len());
                }
                Err(e) => println!("  #{:<2} FAIL {:>7.0}ms  {}", i + 1, t.elapsed().as_millis(), e.lines().next().unwrap_or("")),
            }
        }
        println!("成功率 {}/{}", ok, n);
    }
}
