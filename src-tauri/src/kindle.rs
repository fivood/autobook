//! Find a USB-connected Kindle and list the book files on it.
//!
//! Recent Kindles still mount as plain mass storage on Windows, so this is a
//! drive-letter scan for `system\version.txt`. The frontend reads the files
//! itself through the fs plugin, which is why the command also grants scope.

use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

#[derive(serde::Serialize)]
pub struct KindleScan {
  root: String,
  version: String,
  books: Vec<String>,
  /// Nosebleed and friends leave `documents/JAILBROKEN.txt` behind.
  jailbroken: bool,
  /// KOReader installed (its folder exists), whether or not it has run yet.
  koreader: bool,
}

#[tauri::command]
pub fn find_kindle_books(app: tauri::AppHandle) -> Result<Option<KindleScan>, String> {
  let Some((root, version)) = find_kindle_root() else {
    return Ok(None);
  };
  let docs = root.join("documents");
  // Granted for this process only and deliberately not remembered like
  // `pick_user_dir` does: the drive letter is whatever Windows handed out
  // this time, and next time it may belong to some other disk.
  app
    .fs_scope()
    .allow_directory(&docs, true)
    .map_err(|e| e.to_string())?;

  let mut books = Vec::new();
  collect_books(&docs, &mut books);
  books.sort();
  Ok(Some(KindleScan {
    jailbroken: docs.join("JAILBROKEN.txt").is_file(),
    koreader: root.join("koreader").is_dir(),
    root: root.to_string_lossy().into_owned(),
    version,
    books: books
      .into_iter()
      .map(|p| p.to_string_lossy().into_owned())
      .collect(),
  }))
}

fn candidate_roots() -> Vec<PathBuf> {
  if cfg!(windows) {
    (b'C'..=b'Z')
      .map(|l| PathBuf::from(format!("{}:\\", l as char)))
      .collect()
  } else {
    vec![PathBuf::from("/Volumes/Kindle")]
  }
}

fn find_kindle_root() -> Option<(PathBuf, String)> {
  candidate_roots().into_iter().find_map(|root| {
    let version = std::fs::read_to_string(root.join("system").join("version.txt")).ok()?;
    let version = version.trim().to_string();
    (version.starts_with("Kindle") && root.join("documents").is_dir()).then_some((root, version))
  })
}

const BOOK_EXTS: [&str; 5] = ["azw3", "azw", "mobi", "epub", "pdf"];

fn collect_books(dir: &Path, out: &mut Vec<PathBuf>) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().into_owned();
    // `._x` are macOS resource forks (this Kindle has been on a Mac); `.sdr`
    // holds Kindle's own sidecar data; `dictionaries` are not books.
    if name.starts_with('.') {
      continue;
    }
    if path.is_dir() {
      if !name.ends_with(".sdr") && name != "dictionaries" {
        collect_books(&path, out);
      }
      continue;
    }
    let is_book = path
      .extension()
      .and_then(|e| e.to_str())
      .is_some_and(|e| BOOK_EXTS.iter().any(|b| b.eq_ignore_ascii_case(e)));
    if is_book {
      out.push(path);
    }
  }
}
