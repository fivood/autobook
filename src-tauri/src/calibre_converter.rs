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

#[tauri::command]
pub async fn convert_with_calibre(bytes: Vec<u8>, filename: String) -> Result<Vec<u8>, String> {
    let converter = find_calibre_convert()
        .ok_or_else(|| "未检测到 Calibre，请安装 Calibre 或使用内置解析器".to_string())?;

    // `filename` originates from the frontend import flow but is joined into a
    // temp dir below — take only the basename so a value like `..\..\evil` or
    // an absolute path can't escape `autobook_convert`.
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty() && *n != "." && *n != "..")
        .ok_or_else(|| "文件名无效".to_string())?
        .to_string();

    let tmp_dir = std::env::temp_dir().join("autobook_convert");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let input_path = tmp_dir.join(&safe_name);
    let epub_name = PathBuf::from(&safe_name).with_extension("epub");
    let output_path = tmp_dir.join(&epub_name);

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

    Ok(epub_bytes)
}
