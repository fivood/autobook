//! Piper TTS — local neural network voices via the bundled piper.exe binary.
//!
//! Architecture:
//! - `piper.exe` + ONNX Runtime DLLs ship as a Tauri sidecar in `resources/piper/`
//! - Voice files (.onnx + .json pair per voice) live in the user's data dir:
//!   `%LOCALAPPDATA%/io.github.fukki.ebookreader/piper-voices/`
//! - Each synth call spawns piper.exe, pipes text on stdin, reads WAV on stdout
//!
//! Voice files are NOT bundled (each is ~50MB). The frontend exposes a "打开
//! 音色文件夹" button and download links; piper supports drop-in voice files.

use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(serde::Serialize, Clone)]
pub struct PiperVoice {
  pub id: String,        // filename without .onnx extension
  pub name: String,      // human-readable from config json or filename
  pub language: String,  // BCP47 from config
  pub file: String,      // absolute path to the .onnx file
}

/// Piper binary and its voices share one user folder so the user only has to
/// open one place to set everything up. The folder is `%LOCALAPPDATA%/
/// io.github.fukki.ebookreader/piper/`.
pub fn piper_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  Ok(voices_dir(app)?.join("piper.exe"))
}

pub fn voices_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_local_data_dir()
    .map_err(|e| e.to_string())?
    .join("piper");
  if !dir.exists() {
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(dir)
}

pub fn list_voices(app: &tauri::AppHandle) -> Result<Vec<PiperVoice>, String> {
  let dir = voices_dir(app)?;
  let mut voices = Vec::new();
  let entries = match std::fs::read_dir(&dir) {
    Ok(it) => it,
    Err(_) => return Ok(voices),
  };

  for entry in entries.flatten() {
    let path = entry.path();
    if path.extension().and_then(|e| e.to_str()) != Some("onnx") {
      continue;
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    if stem.is_empty() {
      continue;
    }

    let cfg_path = path.with_extension("onnx.json");
    let (name, language) = read_voice_metadata(&cfg_path)
      .unwrap_or_else(|| (humanize_id(&stem), guess_lang_from_id(&stem)));

    voices.push(PiperVoice {
      id: stem,
      name,
      language,
      file: path.display().to_string(),
    });
  }

  voices.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(voices)
}

/// Parse the sidecar `<voice>.onnx.json` for human-readable name + language.
fn read_voice_metadata(path: &Path) -> Option<(String, String)> {
  let text = std::fs::read_to_string(path).ok()?;
  let value: serde_json::Value = serde_json::from_str(&text).ok()?;
  let lang = value
    .pointer("/language/code")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
    .unwrap_or_else(|| "und".into());
  let dataset = value
    .pointer("/dataset")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let quality = value
    .pointer("/audio/quality")
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());
  let display_parts: Vec<String> = [dataset, quality].into_iter().flatten().collect();
  let name = if display_parts.is_empty() {
    "Piper voice".into()
  } else {
    display_parts.join(" • ")
  };
  Some((name, lang))
}

fn humanize_id(stem: &str) -> String {
  stem.replace(['_', '-'], " ")
}

fn guess_lang_from_id(stem: &str) -> String {
  let lower = stem.to_lowercase();
  for prefix in ["zh_cn", "zh_hk", "zh_tw", "ja_jp", "en_us", "en_gb"] {
    if lower.starts_with(prefix) {
      return prefix.replace('_', "-");
    }
  }
  "und".into()
}

pub async fn synthesize(
  app: &tauri::AppHandle,
  voice_file: &str,
  rate: f32,
  text: &str,
) -> Result<Vec<u8>, String> {
  let piper = piper_path(app)?;
  if !piper.exists() {
    return Err(format!(
      "未找到 piper.exe（应位于 {}）",
      piper.display()
    ));
  }

  let voice_path = Path::new(voice_file);
  if !voice_path.exists() {
    return Err(format!("音色文件不存在: {}", voice_file));
  }

  // piper takes rate via `--length_scale` which is INVERSE: smaller = faster.
  let length_scale = (1.0 / rate.max(0.25)).clamp(0.5, 4.0);

  let mut cmd = tokio::process::Command::new(&piper);
  cmd
    .arg("--model").arg(voice_path)
    .arg("--output_raw")            // raw PCM to stdout (we'll wrap to WAV)
    .arg("--length_scale").arg(length_scale.to_string())
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

  #[cfg(windows)]
  {
    // CREATE_NO_WINDOW so each spawn doesn't flash a console
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
  }

  let mut child = cmd.spawn().map_err(|e| format!("启动 piper 失败: {e}"))?;

  if let Some(mut stdin) = child.stdin.take() {
    stdin
      .write_all(text.as_bytes())
      .await
      .map_err(|e| e.to_string())?;
    drop(stdin);
  }

  let mut pcm = Vec::new();
  if let Some(mut stdout) = child.stdout.take() {
    stdout.read_to_end(&mut pcm).await.map_err(|e| e.to_string())?;
  }

  let status = child.wait().await.map_err(|e| e.to_string())?;
  if !status.success() {
    let mut stderr = String::new();
    if let Some(mut s) = child.stderr.take() {
      let _ = s.read_to_string(&mut stderr).await;
    }
    return Err(format!("piper 进程退出（{status}）: {stderr}"));
  }

  // Piper outputs 22050Hz 16-bit mono PCM. Wrap as a WAV blob the
  // frontend can hand straight to HTMLAudioElement.
  Ok(wrap_pcm_as_wav(&pcm, 22050, 1, 16))
}

fn wrap_pcm_as_wav(pcm: &[u8], sample_rate: u32, channels: u16, bits: u16) -> Vec<u8> {
  let byte_rate = sample_rate * channels as u32 * (bits as u32 / 8);
  let block_align = channels * (bits / 8);
  let data_size = pcm.len() as u32;
  let chunk_size = 36 + data_size;

  let mut out = Vec::with_capacity(44 + pcm.len());
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&chunk_size.to_le_bytes());
  out.extend_from_slice(b"WAVE");
  out.extend_from_slice(b"fmt ");
  out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
  out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
  out.extend_from_slice(&channels.to_le_bytes());
  out.extend_from_slice(&sample_rate.to_le_bytes());
  out.extend_from_slice(&byte_rate.to_le_bytes());
  out.extend_from_slice(&block_align.to_le_bytes());
  out.extend_from_slice(&bits.to_le_bytes());
  out.extend_from_slice(b"data");
  out.extend_from_slice(&data_size.to_le_bytes());
  out.extend_from_slice(pcm);
  out
}
