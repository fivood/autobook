use std::sync::Mutex;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{TrayIconBuilder, TrayIconEvent},
  Emitter, Manager, WindowEvent,
};
use tauri_plugin_fs::FsExt;

mod calibre_converter;
mod custom_tts;
mod edge_tts;
mod kf8_indx;
mod kf8_parser;
mod mobi_parser;
mod winrt_tts;

#[cfg(test)]
mod mobi_scan_test;


/// Set when the tray "退出" menu item is chosen so the WindowEvent handler
/// knows to let the close request through instead of hiding to tray.
static QUIT_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn request_quit(app: &tauri::AppHandle) {
  QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
  app.exit(0);
}

const BOOK_EXTS: [&str; 13] = [
    "epub", "txt", "htmlz", "md", "markdown", "mobi", "azw", "azw3", "pdf",
    "cbz", "cbr", "cb7", "cbt",
];

/// File paths handed to the app via file association / command line, waiting
/// for the frontend to pick them up.
struct LaunchFiles(Mutex<Vec<String>>);

fn collect_book_files<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
  args
    .into_iter()
    .filter(|arg| {
      let path = std::path::Path::new(arg);
      path.is_file()
        && path
          .extension()
          .and_then(|ext| ext.to_str())
          .map(|ext| BOOK_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
          .unwrap_or(false)
    })
    .collect()
}

/// Whitelist exact launch paths in the fs scope so the frontend can read just
/// these files without widening the general scope.
fn allow_paths(app: &tauri::AppHandle, paths: &[String]) {
  let scope = app.fs_scope();
  for path in paths {
    let _ = scope.allow_file(path);
  }
}

/// Path to the marker file that signals "delete WebView2 Local Storage on next launch".
fn reset_flag_path() -> std::path::PathBuf {
  let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
  std::path::PathBuf::from(base).join("io.github.fukki.ebookreader/reset-ui.flag")
}

/// Path to the marker file that signals "delete EVERYTHING — Local Storage,
/// IndexedDB, the lot — on next launch". Used by the nuclear data reset.
fn full_reset_flag_path() -> std::path::PathBuf {
  let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
  std::path::PathBuf::from(base).join("io.github.fukki.ebookreader/reset-full.flag")
}

fn webview_local_storage_dirs() -> Vec<std::path::PathBuf> {
  webview_subdir_paths("Default/Local Storage")
}

fn webview_indexeddb_dirs() -> Vec<std::path::PathBuf> {
  webview_subdir_paths("Default/IndexedDB")
}

fn webview_subdir_paths(rel: &str) -> Vec<std::path::PathBuf> {
  let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
  let root = std::path::PathBuf::from(base).join("io.github.fukki.ebookreader/EBWebView");
  let mut out = Vec::new();
  if let Ok(entries) = std::fs::read_dir(&root) {
    for entry in entries.flatten() {
      let path = entry.path();
      let target = path.join(rel);
      if target.exists() {
        out.push(target);
      }
    }
  }
  out
}

/// Runs before the WebView2 process is spawned. Removes Local Storage if the
/// reset flag exists. We don't touch IndexedDB so books survive.
/// One-time migration: pre-1.2.9 the books root was `Documents/EbookReader/`
/// (carried over from the upstream ttu-reader fork name). Rename to
/// `Documents/AutoBook/` on first launch of the new version so the app's
/// name and its data folder match.
fn migrate_books_dir() {
  let docs = match std::env::var("USERPROFILE") {
    Ok(home) => std::path::PathBuf::from(home).join("Documents"),
    Err(_) => return,
  };
  let old = docs.join("EbookReader");
  let new_dir = docs.join("AutoBook");
  if old.exists() && !new_dir.exists() {
    if let Err(e) = std::fs::rename(&old, &new_dir) {
      eprintln!("[migrate] EbookReader -> AutoBook rename failed: {e}");
    }
  }
}

fn run_pending_reset() {
  let full_flag = full_reset_flag_path();
  if full_flag.exists() {
    for dir in webview_local_storage_dirs() {
      let _ = std::fs::remove_dir_all(&dir);
    }
    for dir in webview_indexeddb_dirs() {
      let _ = std::fs::remove_dir_all(&dir);
    }
    let _ = std::fs::remove_file(&full_flag);
    return;
  }
  let flag = reset_flag_path();
  if !flag.exists() {
    return;
  }
  for dir in webview_local_storage_dirs() {
    let _ = std::fs::remove_dir_all(&dir);
  }
  let _ = std::fs::remove_file(&flag);
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[tauri::command]
fn take_launch_files(state: tauri::State<LaunchFiles>) -> Vec<String> {
  let mut guard = state.0.lock().unwrap();
  std::mem::take(&mut *guard)
}

/// Schedule a Local Storage wipe on next launch and restart. Used by both the
/// tray menu and the settings page reset button.
#[tauri::command]
fn schedule_ui_reset(app: tauri::AppHandle) -> Result<(), String> {
  let flag = reset_flag_path();
  if let Some(parent) = flag.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  std::fs::write(&flag, b"1").map_err(|e| e.to_string())?;
  QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
  app.restart();
}

/// Schedule a FULL data wipe on next launch (Local Storage + IndexedDB) and
/// restart. After this all books, highlights, notebook, statistics, and UI
/// settings are gone — confirm twice on the frontend before calling.
#[tauri::command]
fn schedule_full_reset(app: tauri::AppHandle) -> Result<(), String> {
  let flag = full_reset_flag_path();
  if let Some(parent) = flag.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  std::fs::write(&flag, b"1").map_err(|e| e.to_string())?;
  QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
  app.restart();
}

fn default_documents_root_path() -> std::path::PathBuf {
  std::env::var("USERPROFILE")
    .map(|h| std::path::PathBuf::from(h).join("Documents").join("AutoBook"))
    .unwrap_or_default()
}

/// The default library folder (`%USERPROFILE%\Documents\AutoBook`) — the
/// frontend uses this to show what "restore default" would pick.
#[tauri::command]
fn default_fs_root() -> String {
  default_documents_root_path().to_string_lossy().into_owned()
}

/// Return paths the frontend can show in a Settings → Data panel so the
/// user knows where their books and settings actually live. `fs_root` is
/// the user-chosen library folder (empty = default). Sizes are computed
/// best-effort; huge directories may report 0 to avoid blocking.
#[tauri::command]
fn get_data_paths(fs_root: Option<String>) -> serde_json::Value {
  fn dir_size(p: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(p) {
      for entry in entries.flatten().take(20000) {
        if let Ok(md) = entry.metadata() {
          if md.is_file() {
            total = total.saturating_add(md.len());
          } else if md.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
          }
        }
      }
    }
    total
  }

  let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
  let webview_root =
    std::path::PathBuf::from(&local_appdata).join("io.github.fukki.ebookreader/EBWebView");
  let default_root = default_documents_root_path();
  let effective_root = fs_root
    .as_deref()
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|| default_root.clone());

  let ls_dirs: Vec<String> = webview_local_storage_dirs()
    .into_iter()
    .map(|p| p.to_string_lossy().into_owned())
    .collect();
  let idb_dirs: Vec<String> = webview_indexeddb_dirs()
    .into_iter()
    .map(|p| p.to_string_lossy().into_owned())
    .collect();

  let idb_size: u64 = webview_indexeddb_dirs().iter().map(|p| dir_size(p)).sum();
  let root_size = if effective_root.exists() { dir_size(&effective_root) } else { 0 };

  serde_json::json!({
    "webviewRoot": webview_root.to_string_lossy(),
    "localStorageDirs": ls_dirs,
    "indexeddbDirs": idb_dirs,
    "indexeddbBytes": idb_size,
    "fsRoot": effective_root.to_string_lossy(),
    "fsRootBytes": root_size,
    "fsRootExists": effective_root.exists(),
    "defaultFsRoot": default_root.to_string_lossy(),
    "isDefaultFsRoot": effective_root == default_root,
  })
}

fn dir_is_empty(p: &std::path::Path) -> bool {
  std::fs::read_dir(p).map(|mut it| it.next().is_none()).unwrap_or(false)
}

/// Move a directory to a new location. Tries a plain rename first (instant,
/// same volume); on cross-volume rename failure it falls back to recursive
/// copy + remove. `to` may be an empty existing directory — that's the normal
/// case when the frontend's folder picker returned an already-created folder.
/// Refuses to clobber a target that already contains files.
#[tauri::command]
fn move_directory(from: String, to: String) -> Result<(), String> {
  let from_path = std::path::PathBuf::from(&from);
  let to_path = std::path::PathBuf::from(&to);
  if !from_path.exists() {
    return Err(format!("源文件夹不存在: {from}"));
  }
  if from_path == to_path {
    return Ok(());
  }
  if to_path.exists() {
    if !to_path.is_dir() {
      return Err(format!("目标不是目录: {to}"));
    }
    if !dir_is_empty(&to_path) {
      return Err(format!("目标已存在且不为空: {to}"));
    }
    // Rename won't work when the target dir already exists (even empty) on
    // Windows — remove it first so the rename can create it fresh.
    std::fs::remove_dir(&to_path).map_err(|e| e.to_string())?;
  }
  if let Some(parent) = to_path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  if std::fs::rename(&from_path, &to_path).is_ok() {
    return Ok(());
  }

  // Cross-volume or locked — fall back to copy + remove.
  copy_dir_recursive(&from_path, &to_path).map_err(|e| e.to_string())?;
  std::fs::remove_dir_all(&from_path).map_err(|e| e.to_string())?;
  Ok(())
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
  std::fs::create_dir_all(to)?;
  for entry in std::fs::read_dir(from)? {
    let entry = entry?;
    let file_type = entry.file_type()?;
    let target = to.join(entry.file_name());
    if file_type.is_dir() {
      copy_dir_recursive(&entry.path(), &target)?;
    } else {
      std::fs::copy(entry.path(), &target)?;
    }
  }
  Ok(())
}

/// Open a folder in the OS file manager (Explorer on Windows). The path
/// is created if missing — handy for "open my AutoBook folder" before any
/// sync has actually written there.
#[tauri::command]
fn open_data_folder(path: String) -> Result<(), String> {
  let p = std::path::PathBuf::from(&path);
  if !p.exists() {
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
  }
  // Spawn explorer.exe; on non-Windows builds this command is irrelevant.
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&p)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn sapi_list_voices() -> Result<Vec<winrt_tts::SapiVoice>, String> {
  winrt_tts::list_voices()
}

/// Synthesize via WinRT SpeechSynthesizer. Returns a base64 WAV the frontend
/// plays with HTMLAudioElement (same plumbing as Edge). Natural / Online
/// neural voices are picked up automatically once installed via Windows
/// Settings → Accessibility → Narrator → Add natural voices.
#[tauri::command]
async fn sapi_speak(
  text: String,
  voice_id: Option<String>,
  rate: Option<f32>,
) -> Result<String, String> {
  let rate = rate.unwrap_or(1.0);
  let audio = tokio::task::spawn_blocking(move || {
    winrt_tts::synthesize_blocking(voice_id.as_deref(), rate, &text)
  })
  .await
  .map_err(|e| e.to_string())??;
  use base64::Engine;
  Ok(base64::engine::general_purpose::STANDARD.encode(&audio))
}

/// Run a user-configured HTTP TTS request. Returns base64 audio bytes
/// (whatever Content-Type the API gave us — frontend tries audio/mpeg, then
/// audio/wav). Body template uses `{text}` as the substitution token.
#[tauri::command]
async fn custom_tts_synthesize(
  endpoint: String,
  method: String,
  headers: std::collections::HashMap<String, String>,
  body_template: String,
  audio_path: Option<String>,
  proxy_url: Option<String>,
  text: String,
) -> Result<String, String> {
  let audio = custom_tts::synthesize(
    &endpoint,
    &method,
    &headers,
    &body_template,
    audio_path.as_deref(),
    proxy_url.as_deref(),
    &text,
  )
  .await?;
  use base64::Engine;
  Ok(base64::engine::general_purpose::STANDARD.encode(&audio))
}

/// Replace the currently-registered TTS global shortcut. Empty string clears
/// it. Returns Err with a human-readable message on conflict.
#[tauri::command]
fn set_tts_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
  use tauri_plugin_global_shortcut::GlobalShortcutExt;
  let gs = app.global_shortcut();
  let _ = gs.unregister_all();
  let trimmed = accelerator.trim();
  if trimmed.is_empty() {
    return Ok(());
  }
  gs.register(trimmed).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  migrate_books_dir();
  run_pending_reset();
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      show_main_window(app);
      let files = collect_book_files(args.into_iter().skip(1));
      if !files.is_empty() {
        allow_paths(app, &files);
        let _ = app.emit("open-files", files);
      }
    }))
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(LaunchFiles(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![
      take_launch_files,
      set_tts_shortcut,
      sapi_list_voices,
      sapi_speak,
      custom_tts_synthesize,
      edge_tts::edge_tts_synthesize,
      schedule_ui_reset,
      schedule_full_reset,
      get_data_paths,
      open_data_folder,
      default_fs_root,
      move_directory,
      mobi_parser::parse_mobi,
      calibre_converter::check_calibre,
      calibre_converter::convert_with_calibre
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Files passed on first launch (double-click association / CLI)
      let launch_files = collect_book_files(std::env::args().skip(1));
      if !launch_files.is_empty() {
        allow_paths(app.handle(), &launch_files);
        *app.state::<LaunchFiles>().0.lock().unwrap() = launch_files;
      }

      // Global shortcut plugin: actual binding is set from the frontend
      // (settings) via set_tts_shortcut so users can rebind / disable it.
      {
        use tauri_plugin_global_shortcut::ShortcutState;
        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
              if event.state() == ShortcutState::Pressed {
                let _ = app.emit("tts-toggle", ());
              }
            })
            .build(),
        )?;
      }

      // Tray icon
      {
        let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
        let tts =
          MenuItem::with_id(app, "tts", "播放 / 暂停朗读 (Ctrl+Alt+P)", true, None::<&str>)?;
        let reset =
          MenuItem::with_id(app, "reset", "重置 UI（保留书库）", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &tts, &reset, &quit])?;

        TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&menu)
          .show_menu_on_left_click(false)
          .tooltip("AutoBook")
          .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "tts" => {
              let _ = app.emit("tts-toggle", ());
            }
            "reset" => {
              let flag = reset_flag_path();
              if let Some(parent) = flag.parent() {
                let _ = std::fs::create_dir_all(parent);
              }
              let _ = std::fs::write(&flag, b"1");
              QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
              app.restart();
            }
            "quit" => request_quit(app),
            _ => {}
          })
          .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
              show_main_window(tray.app_handle());
            }
          })
          .build(app)?;
      }

      // Close button hides to tray; the tray "退出" item is the only real exit.
      if let Some(window) = app.get_webview_window("main") {
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
          if let WindowEvent::CloseRequested { api, .. } = event {
            if QUIT_REQUESTED.load(std::sync::atomic::Ordering::SeqCst) {
              return;
            }
            api.prevent_close();
            if let Some(w) = app_handle.get_webview_window("main") {
              let _ = w.hide();
            }
          }
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
