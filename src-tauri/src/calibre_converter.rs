use std::path::PathBuf;
use std::process::Command;

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
    if let Ok(output) = Command::new("where").arg("ebook-convert").output() {
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

/// Async so the `where ebook-convert` probe doesn't run on the main thread.
#[tauri::command]
pub async fn check_calibre() -> bool {
    tokio::task::spawn_blocking(|| find_calibre_convert().is_some())
        .await
        .unwrap_or(false)
}

/// Book bytes ride in as the raw IPC body and the EPUB comes back the same
/// way; as command arguments they were JSON arrays of numbers, which for a
/// 30 MB book meant building a thirty-million element array on each side.
///
/// Only the source extension crosses the bridge, not the filename. The temp
/// file is named here from a counter, so nothing user-controlled reaches
/// `join()` — a book called `..\..\evil` has no say in where we write.
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

    // ebook-convert can run for a minute on a big book; keep it off the async
    // runtime's worker threads.
    let epub = tokio::task::spawn_blocking(move || run_calibre(&bytes, &ext))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(epub))
}

/// Keep only what can safely be an extension: ASCII alphanumerics, capped.
fn sanitize_ext(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    if cleaned.is_empty() {
        "mobi".to_string()
    } else {
        cleaned
    }
}

fn run_calibre(bytes: &[u8], ext: &str) -> Result<Vec<u8>, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);

    let converter = find_calibre_convert()
        .ok_or_else(|| "未检测到 Calibre，请安装 Calibre 或使用内置解析器".to_string())?;

    let tmp_dir = std::env::temp_dir().join("autobook_convert");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let stem = format!(
        "in-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let input_path = tmp_dir.join(format!("{stem}.{ext}"));
    let output_path = tmp_dir.join(format!("{stem}.epub"));

    if output_path.exists() {
        let _ = std::fs::remove_file(&output_path);
    }

    std::fs::write(&input_path, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

    let result = Command::new(&converter)
        .arg(&input_path)
        .arg(&output_path)
        .output()
        .map_err(|e| format!("调用 ebook-convert 失败: {e}"))?;

    let _ = std::fs::remove_file(&input_path);

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Calibre 转换失败: {stderr}"));
    }

    let epub_bytes =
        std::fs::read(&output_path).map_err(|e| format!("读取转换结果失败: {e}"))?;
    let _ = std::fs::remove_file(&output_path);

    Ok(epub_bytes)
}
