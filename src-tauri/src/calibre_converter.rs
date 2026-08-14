use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Calibre's ebook-convert occasionally hangs on malformed or very large MOBI
/// files, and running it from a GUI parent creates a visible console window.
/// Cap the wait and hide the window to keep the experience smooth.
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(300);

fn find_calibre_convert() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Calibre2\ebook-convert.exe",
        r"C:\Program Files (x86)\Calibre2\ebook-convert.exe",
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(output) = std::process::Command::new("where").arg("ebook-convert").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                let p = PathBuf::from(line.trim());
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn check_calibre() -> bool {
    find_calibre_convert().is_some()
}

/// Keep only what can legally be an extension. Anything else collapses to
/// `bin` — the value crosses from the frontend and is about to be joined into
/// a path, so `..`, separators and the rest never survive.
fn sanitize_ext(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if cleaned.is_empty() {
        "bin".to_string()
    } else {
        cleaned.to_ascii_lowercase()
    }
}

/// The book rides in as the raw IPC body and the EPUB comes back the same way.
/// As a `Vec<u8>` command argument the bytes were serialized as a JSON array
/// of numbers, so importing a 30 MB AZW3 meant building — and parsing — a
/// thirty-million-element array on each side of the bridge.
///
/// Only the source extension crosses now, never the filename: the temp file is
/// named here from a counter, so nothing user-controlled reaches `join()`.
#[tauri::command]
pub async fn convert_with_calibre(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("convert_with_calibre 需要原始字节负载".into()),
    };

    let ext = request
        .headers()
        .get("x-source-ext")
        .and_then(|value| value.to_str().ok())
        .map(sanitize_ext)
        .unwrap_or_else(|| "mobi".to_string());

    let converter = find_calibre_convert()
        .ok_or_else(|| "未检测到 Calibre，请安装 Calibre 或使用内置解析器".to_string())?;

    let tmp_dir = std::env::temp_dir().join("autobook_convert");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    // A counter rather than the book's name: two imports running at once would
    // otherwise write the same temp path and clobber each other's output.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let stem = format!(
        "in_{}_{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );

    let input_path = tmp_dir.join(format!("{stem}.{ext}"));
    let output_path = tmp_dir.join(PathBuf::from(&stem).with_extension("epub"));

    if output_path.exists() {
        let _ = std::fs::remove_file(&output_path);
    }

    std::fs::write(&input_path, &bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

    let mut cmd = Command::new(&converter);
    cmd.arg(&input_path).arg(&output_path);

    // Prevent ebook-convert from flashing a black console window on Windows.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Kill the process if it runs too long — this avoids the UI freezing
    // indefinitely when ebook-convert hangs on a problematic file.
    cmd.kill_on_drop(true);

    let result = timeout(CONVERSION_TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            "Calibre 转换超时（超过 5 分钟），ebook-convert 可能已卡住。".to_string() +
                "建议先用 Calibre 手动把该书转成 EPUB，再导入 AutoBook。"
        })?
        .map_err(|e| format!("调用 ebook-convert 失败: {e}"))?;

    let _ = std::fs::remove_file(&input_path);

    if !result.status.success() {
        let _ = std::fs::remove_file(&output_path);
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("Calibre 转换失败: {stderr}"));
    }

    let epub_bytes =
        std::fs::read(&output_path).map_err(|e| format!("读取转换结果失败: {e}"))?;
    let _ = std::fs::remove_file(&output_path);

    Ok(tauri::ipc::Response::new(epub_bytes))
}
