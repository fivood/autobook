use std::sync::Mutex;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{TrayIconBuilder, TrayIconEvent},
  Emitter, Manager, WindowEvent,
};
use tauri_plugin_fs::FsExt;

/// Set when the tray "退出" menu item is chosen so the WindowEvent handler
/// knows to let the close request through instead of hiding to tray.
static QUIT_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn request_quit(app: &tauri::AppHandle) {
  QUIT_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
  app.exit(0);
}

const BOOK_EXTS: [&str; 3] = ["epub", "txt", "htmlz"];

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
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
      show_main_window(app);
      let files = collect_book_files(args.into_iter().skip(1));
      if !files.is_empty() {
        allow_paths(app, &files);
        let _ = app.emit("open-files", files);
      }
    }))
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(LaunchFiles(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![take_launch_files, set_tts_shortcut])
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
        let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &tts, &quit])?;

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
