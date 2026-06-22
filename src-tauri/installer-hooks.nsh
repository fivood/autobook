; AutoBook NSIS installer hooks
;
; Why this exists: Tauri's silent updater downloads the new installer and runs
; it with /S. By default NSIS skips files that are open by another process —
; when WebView2 subprocesses are still holding the old `resources/` JS bundle,
; the install silently leaves the old frontend on disk while overwriting only
; `app.exe`. The user ends up with a "1.9.0" title bar but a 1.7.x UI.
;
; Pre-install: kill any lingering AutoBook + WebView2 children, then force
; SetOverwrite on so the file copy step really overwrites everything.

!macro NSIS_HOOK_PREINSTALL
  ; Best-effort process termination. nsExec::Exec sets $0 to the exit code;
  ; we don't care if taskkill found nothing (exit 128) — only that any live
  ; process is gone before we touch the resources directory.
  DetailPrint "Closing any running AutoBook instances..."
  nsExec::Exec 'taskkill /F /IM "app.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "AutoBook.exe" /T'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "msedgewebview2.exe" /T'
  Pop $0
  Sleep 800
  SetOverwrite on
!macroend
