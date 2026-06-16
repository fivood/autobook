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

#[tauri::command]
pub fn check_calibre() -> bool {
    find_calibre_convert().is_some()
}

#[tauri::command]
pub async fn convert_with_calibre(bytes: Vec<u8>, filename: String) -> Result<Vec<u8>, String> {
    let converter = find_calibre_convert()
        .ok_or_else(|| "未检测到 Calibre，请安装 Calibre 或使用内置解析器".to_string())?;

    let tmp_dir = std::env::temp_dir().join("autobook_convert");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let input_path = tmp_dir.join(&filename);
    let epub_name = PathBuf::from(&filename).with_extension("epub");
    let output_path = tmp_dir.join(&epub_name);

    if output_path.exists() {
        let _ = std::fs::remove_file(&output_path);
    }

    std::fs::write(&input_path, &bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;

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
