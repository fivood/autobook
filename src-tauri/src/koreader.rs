//! Read KOReader's reading records off a connected (jailbroken) Kindle.
//!
//! Two sources, both on the USB-visible partition: the statistics plugin's
//! SQLite database (per-page reading sessions), and the per-book sidecar
//! `*.sdr/metadata.<ext>.lua` next to each book (progress, highlights). The
//! Lua is returned as text; the frontend parses it (koreader.ts) where it can
//! be unit-tested.

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoSession {
  start_time: i64,
  duration: i64,
  total_pages: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoBook {
  title: String,
  md5: String,
  last_open: i64,
  sessions: Vec<KoSession>,
}

#[derive(serde::Serialize)]
pub struct KoSidecar {
  path: String,
  lua: String,
}

#[derive(serde::Serialize)]
pub struct KoData {
  books: Vec<KoBook>,
  sidecars: Vec<KoSidecar>,
}

/// None when KOReader has never run on this Kindle (no settings folder yet).
#[tauri::command]
pub fn read_koreader(root: String) -> Result<Option<KoData>, String> {
  let root = PathBuf::from(root);
  let db = root.join("koreader").join("settings").join("statistics.sqlite3");
  if !db.parent().is_some_and(|p| p.is_dir()) {
    return Ok(None);
  }
  let books = if db.is_file() {
    read_stats(&db).map_err(|e| format!("statistics.sqlite3: {e}"))?
  } else {
    Vec::new()
  };
  let mut sidecars = Vec::new();
  collect_sidecars(&root.join("documents"), &mut sidecars);
  Ok(Some(KoData { books, sidecars }))
}

fn read_stats(db: &Path) -> rusqlite::Result<Vec<KoBook>> {
  // immutable=1: never create a journal or touch the file. It lives on the
  // Kindle, and KOReader is the only thing that should ever write it.
  let uri = format!("file:{}?immutable=1", db.to_string_lossy().replace('\\', "/"));
  let conn = Connection::open_with_flags(
    uri,
    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
  )?;

  let mut books_stmt =
    conn.prepare("SELECT id, title, md5, last_open FROM book ORDER BY id")?;
  let mut sessions_stmt = conn.prepare(
    "SELECT start_time, duration, total_pages FROM page_stat_data WHERE id_book = ?1 ORDER BY start_time",
  )?;

  let rows = books_stmt.query_map([], |r| {
    Ok((
      r.get::<_, i64>(0)?,
      r.get::<_, Option<String>>(1)?.unwrap_or_default(),
      r.get::<_, Option<String>>(2)?.unwrap_or_default(),
      r.get::<_, Option<i64>>(3)?.unwrap_or(0),
    ))
  })?;

  let mut books = Vec::new();
  for row in rows {
    let (id, title, md5, last_open) = row?;
    let sessions = sessions_stmt
      .query_map([id], |r| {
        Ok(KoSession {
          start_time: r.get(0)?,
          duration: r.get(1)?,
          total_pages: r.get(2)?,
        })
      })?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    books.push(KoBook { title, md5, last_open, sessions });
  }
  Ok(books)
}

/// ponytail: only the default "next to the book" sidecar location. KOReader
/// can also keep them under koreader/docsettings or hashdocsettings; read
/// those too if anyone switches that setting.
fn collect_sidecars(dir: &Path, out: &mut Vec<KoSidecar>) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().into_owned();
    if !path.is_dir() || name.starts_with('.') {
      continue;
    }
    if !name.ends_with(".sdr") {
      collect_sidecars(&path, out);
      continue;
    }
    let Ok(files) = std::fs::read_dir(&path) else {
      continue;
    };
    for file in files.flatten() {
      let fname = file.file_name().to_string_lossy().into_owned();
      if fname.starts_with("metadata.") && fname.ends_with(".lua") && !fname.ends_with(".old") {
        if let Ok(lua) = std::fs::read_to_string(file.path()) {
          out.push(KoSidecar {
            path: file.path().to_string_lossy().into_owned(),
            lua,
          });
        }
      }
    }
  }
}
