//! User-configurable HTTP TTS engine.
//!
//! Lets the user wire up any cloud TTS API (OpenAI, ElevenLabs, Azure,
//! 火山 / 讯飞 / 智谱 / ...) by filling in URL + headers + body template.
//! The template uses `{text}` as a placeholder that we substitute (with the
//! JSON-escaped sentence text) before sending.
//!
//! Response is treated as raw audio bytes; the frontend wraps them in a Blob
//! and plays via HTMLAudioElement. JSON-wrapped responses (rare) need to be
//! handled by a future iteration.

use std::collections::HashMap;
use std::time::Duration;

pub async fn synthesize(
  endpoint: &str,
  method: &str,
  headers: &HashMap<String, String>,
  body_template: &str,
  audio_path: Option<&str>,
  text: &str,
) -> Result<Vec<u8>, String> {
  let body = body_template.replace("{text}", &json_escape(text));

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .build()
    .map_err(|e| e.to_string())?;

  let method_upper = method.trim().to_uppercase();
  let mut req = match method_upper.as_str() {
    "GET" => client.get(endpoint),
    "POST" => client.post(endpoint).body(body.clone()),
    "PUT" => client.put(endpoint).body(body.clone()),
    other => return Err(format!("不支持的 HTTP 方法: {other}")),
  };
  for (k, v) in headers {
    req = req.header(k, v);
  }

  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status();
  let ct = resp
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();
  let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

  if !status.is_success() {
    let preview = String::from_utf8_lossy(&bytes).chars().take(500).collect::<String>();
    return Err(format!("HTTP {status}: {preview}"));
  }

  let path = audio_path.map(str::trim).filter(|s| !s.is_empty());

  // If the user told us where to find base64 audio inside the JSON body, walk
  // the path and decode. Otherwise expect raw audio bytes and reject JSON.
  if let Some(path) = path {
    let json: serde_json::Value =
      serde_json::from_slice(&bytes).map_err(|e| format!("JSON 解析失败: {e}"))?;
    let target = navigate_json(&json, path).ok_or_else(|| {
      format!(
        "在响应里找不到路径 '{path}'：{}",
        truncate_for_error(&json.to_string(), 500)
      )
    })?;
    let b64 = target
      .as_str()
      .ok_or_else(|| format!("路径 '{path}' 不是字符串"))?;
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
      .decode(b64)
      .map_err(|e| format!("base64 解码失败: {e}"))?;
    return Ok(decoded);
  }

  // Refuse obvious JSON / text responses so the user gets a clear error
  // instead of silently feeding HTML to <audio>.
  if ct.starts_with("application/json") || ct.starts_with("text/") {
    let preview = String::from_utf8_lossy(&bytes).chars().take(500).collect::<String>();
    return Err(format!(
      "服务器返回非音频内容（{ct}）：{preview}\n\n如果返回的是 JSON 包 base64 音频，请在「音频路径」里填出 base64 字段的位置（如 choices.0.message.audio.data）。"
    ));
  }

  Ok(bytes.to_vec())
}

/// Dot-notation navigator. Numeric segments index arrays, others index objects.
fn navigate_json<'a>(root: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
  let mut cur = root;
  for part in path.split('.') {
    if part.is_empty() {
      continue;
    }
    cur = match cur {
      serde_json::Value::Object(map) => map.get(part)?,
      serde_json::Value::Array(arr) => {
        let i: usize = part.parse().ok()?;
        arr.get(i)?
      }
      _ => return None,
    };
  }
  Some(cur)
}

fn truncate_for_error(s: &str, max: usize) -> String {
  if s.chars().count() <= max {
    s.to_string()
  } else {
    s.chars().take(max).collect::<String>() + "..."
  }
}

fn json_escape(s: &str) -> String {
  let mut out = String::with_capacity(s.len() + 2);
  for c in s.chars() {
    match c {
      '"' => out.push_str("\\\""),
      '\\' => out.push_str("\\\\"),
      '\n' => out.push_str("\\n"),
      '\r' => out.push_str("\\r"),
      '\t' => out.push_str("\\t"),
      c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
      c => out.push(c),
    }
  }
  out
}
