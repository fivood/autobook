//! HTTP CONNECT tunneling for the WebSocket-based TTS engines.
//!
//! `reqwest` (custom HTTP TTS) handles proxies on its own, but
//! `tokio_tungstenite::connect_async` reads **no** proxy configuration at all
//! — it opens a bare TCP socket. On networks where the target is blocked
//! (mainland China reaches `speech.platform.bing.com` only through a proxy)
//! that surfaces as `tls handshake eof`: the TCP connect succeeds, then the
//! TLS ClientHello gets reset mid-handshake. Custom HTTP TTS working while
//! Edge TTS fails on the same machine is the signature of this bug.
//!
//! So we tunnel by hand: CONNECT to the proxy, then hand the established
//! socket to `client_async_tls_with_config` for the TLS + WS upgrade.
//!
//! Auto-detection matters more than it looks. Clash / v2rayN style clients
//! export `HTTPS_PROXY` into the *shell* only, so a GUI-launched .exe never
//! sees it — the Windows system-proxy registry keys are the sole source that
//! survives launching from the Start menu.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Pick the proxy to use: explicit setting first, then environment, then the
/// Windows system proxy. `None` means connect directly.
///
/// An explicit value of `direct` / `off` / `none` forces a direct connection,
/// which is the only way to opt out once a system proxy is configured.
pub fn resolve(explicit: Option<&str>) -> Option<String> {
  if let Some(v) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
    if matches!(v.to_ascii_lowercase().as_str(), "direct" | "off" | "none") {
      return None;
    }
    return Some(v.to_string());
  }

  for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
    if let Ok(v) = std::env::var(key) {
      let v = v.trim();
      if !v.is_empty() {
        return Some(v.to_string());
      }
    }
  }

  system_proxy()
}

#[cfg(windows)]
fn system_proxy() -> Option<String> {
  use std::ffi::c_void;
  use windows::core::w;
  use windows::Win32::System::Registry::{
    RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
  };

  let subkey = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");

  let mut enabled: u32 = 0;
  let mut size = std::mem::size_of::<u32>() as u32;
  let rc = unsafe {
    RegGetValueW(
      HKEY_CURRENT_USER,
      subkey,
      w!("ProxyEnable"),
      RRF_RT_REG_DWORD,
      None,
      Some(&mut enabled as *mut u32 as *mut c_void),
      Some(&mut size),
    )
  };
  if rc.is_err() || enabled == 0 {
    return None;
  }

  // Size probe: the status is uninteresting because a failure leaves `bytes`
  // at 0, which the check below already treats as "no value".
  let mut bytes: u32 = 0;
  let _ = unsafe {
    RegGetValueW(
      HKEY_CURRENT_USER,
      subkey,
      w!("ProxyServer"),
      RRF_RT_REG_SZ,
      None,
      None,
      Some(&mut bytes),
    )
  };
  if bytes == 0 {
    return None;
  }

  let mut buf = vec![0u16; bytes as usize / 2 + 1];
  let mut cap = bytes;
  let rc = unsafe {
    RegGetValueW(
      HKEY_CURRENT_USER,
      subkey,
      w!("ProxyServer"),
      RRF_RT_REG_SZ,
      None,
      Some(buf.as_mut_ptr() as *mut c_void),
      Some(&mut cap),
    )
  };
  if rc.is_err() {
    return None;
  }

  let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
  parse_proxy_server(&String::from_utf16_lossy(&buf[..end]))
}

#[cfg(not(windows))]
fn system_proxy() -> Option<String> {
  None
}

/// `ProxyServer` is either a bare `host:port` or a per-scheme list like
/// `http=127.0.0.1:7897;https=127.0.0.1:7897;socks=127.0.0.1:7897`. We want
/// the https entry, falling back to http, since we always CONNECT to :443.
fn parse_proxy_server(raw: &str) -> Option<String> {
  let raw = raw.trim();
  if raw.is_empty() {
    return None;
  }

  if !raw.contains('=') {
    return Some(format!("http://{}", raw.trim_start_matches("http://")));
  }

  let mut http = None;
  for part in raw.split(';') {
    let (scheme, addr) = part.split_once('=')?;
    match scheme.trim().to_ascii_lowercase().as_str() {
      // The https= entry is still an HTTP CONNECT proxy, not an HTTPS one.
      "https" => return Some(format!("http://{}", addr.trim())),
      "http" => http = Some(format!("http://{}", addr.trim())),
      _ => {}
    }
  }
  http
}

struct ProxyTarget {
  addr: String,
  auth: Option<String>,
}

fn parse_proxy_url(url: &str) -> Result<ProxyTarget, String> {
  let url = url.trim();
  let (scheme, rest) = match url.split_once("://") {
    Some((s, r)) => (s.to_ascii_lowercase(), r),
    None => ("http".to_string(), url),
  };

  if scheme.starts_with("socks") {
    return Err(format!(
      "Edge TTS 暂不支持 SOCKS 代理（{url}）。请改填 HTTP 代理地址——Clash / v2rayN 的混合端口同时接受 HTTP，通常是 http://127.0.0.1:7897"
    ));
  }
  if scheme != "http" && scheme != "https" {
    return Err(format!("不支持的代理协议: {scheme}"));
  }

  let rest = rest.trim_end_matches('/');
  let (auth, addr) = match rest.rsplit_once('@') {
    Some((cred, host)) => {
      use base64::Engine;
      let encoded = base64::engine::general_purpose::STANDARD.encode(cred.as_bytes());
      (Some(encoded), host.to_string())
    }
    None => (None, rest.to_string()),
  };

  if addr.is_empty() {
    return Err(format!("代理地址为空: {url}"));
  }
  // Bare host means the caller forgot the port; CONNECT proxies have no
  // conventional default, so surface it rather than guessing 80.
  if !addr.contains(':') {
    return Err(format!("代理地址缺少端口: {addr}（如 http://127.0.0.1:7897）"));
  }

  Ok(ProxyTarget { addr, auth })
}

/// Open a TCP connection to `host:port` tunneled through an HTTP CONNECT proxy.
pub async fn connect_tunnel(proxy_url: &str, host: &str, port: u16) -> Result<TcpStream, String> {
  let target = parse_proxy_url(proxy_url)?;

  let mut stream = tokio::time::timeout(Duration::from_secs(15), TcpStream::connect(&target.addr))
    .await
    .map_err(|_| format!("连接代理 {} 超时", target.addr))?
    .map_err(|e| format!("连接代理 {} 失败: {e}", target.addr))?;

  let auth_line = target
    .auth
    .map(|a| format!("Proxy-Authorization: Basic {a}\r\n"))
    .unwrap_or_default();
  let req = format!(
    "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n{auth_line}Proxy-Connection: Keep-Alive\r\n\r\n"
  );
  stream
    .write_all(req.as_bytes())
    .await
    .map_err(|e| format!("代理 CONNECT 发送失败: {e}"))?;

  // Read headers one byte at a time: anything past the terminator belongs to
  // the tunnel itself, so a buffered read could swallow the TLS ServerHello.
  let mut head = Vec::with_capacity(128);
  let mut byte = [0u8; 1];
  loop {
    let n = tokio::time::timeout(Duration::from_secs(15), stream.read(&mut byte))
      .await
      .map_err(|_| "等待代理 CONNECT 响应超时".to_string())?
      .map_err(|e| format!("读取代理响应失败: {e}"))?;
    if n == 0 {
      return Err("代理在返回 CONNECT 响应前关闭了连接".to_string());
    }
    head.push(byte[0]);
    if head.ends_with(b"\r\n\r\n") {
      break;
    }
    if head.len() > 8192 {
      return Err("代理 CONNECT 响应异常（头部过长）".to_string());
    }
  }

  let status_line = String::from_utf8_lossy(&head);
  let status_line = status_line.lines().next().unwrap_or_default();
  let code = status_line.split_whitespace().nth(1).unwrap_or("");
  if code != "200" {
    return Err(format!("代理拒绝 CONNECT: {status_line}"));
  }

  Ok(stream)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_bare_and_scheme_list_proxy_servers() {
    assert_eq!(
      parse_proxy_server("127.0.0.1:7897").as_deref(),
      Some("http://127.0.0.1:7897")
    );
    assert_eq!(
      parse_proxy_server("http=127.0.0.1:1080;https=127.0.0.1:7897").as_deref(),
      Some("http://127.0.0.1:7897")
    );
    assert_eq!(parse_proxy_server("").as_deref(), None);
  }

  #[test]
  fn explicit_direct_keyword_beats_environment() {
    assert_eq!(resolve(Some("direct")), None);
    assert_eq!(resolve(Some("  OFF ")), None);
  }

  #[test]
  fn rejects_socks_and_portless_proxies() {
    assert!(parse_proxy_url("socks5://127.0.0.1:7897").is_err());
    assert!(parse_proxy_url("http://127.0.0.1").is_err());
    assert!(parse_proxy_url("http://127.0.0.1:7897").is_ok());
  }

  #[test]
  fn extracts_basic_auth_credentials() {
    let t = parse_proxy_url("http://user:pass@127.0.0.1:7897").unwrap();
    assert_eq!(t.addr, "127.0.0.1:7897");
    assert_eq!(t.auth.as_deref(), Some("dXNlcjpwYXNz"));
  }
}
