//! API keys in the Windows Credential Manager instead of WebView2 localStorage.
//!
//! localStorage is a plaintext LevelDB under the app's data folder: anything
//! that copies that folder (a backup, a synced profile, a support zip) carries
//! the keys along readable. Credential Manager entries are DPAPI-encrypted to
//! the Windows user and never live in the app's own files.
//!
//! Names are restricted to `[A-Za-z0-9_]` and namespaced under `AutoBook:` so
//! the webview can only reach this app's own entries, not arbitrary generic
//! credentials other programs stored for the same user.

use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::ERROR_NOT_FOUND;
use windows::Win32::Security::Credentials::{
  CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
  CRED_TYPE_GENERIC,
};

fn target(name: &str) -> Result<HSTRING, String> {
  if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
    return Err(format!("invalid secret name: {name:?}"));
  }
  Ok(HSTRING::from(format!("AutoBook:{name}")))
}

fn is_not_found(err: &windows::core::Error) -> bool {
  err.code() == ERROR_NOT_FOUND.to_hresult()
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
  let target = target(&name)?;
  let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
  // SAFETY: CredReadW fills `cred` on success; it is freed below with CredFree.
  match unsafe { CredReadW(&target, CRED_TYPE_GENERIC, 0, &mut cred) } {
    Ok(()) => {
      // SAFETY: on success `cred` points at a valid CREDENTIALW whose blob is
      // `CredentialBlobSize` bytes long.
      let value = unsafe {
        let c = &*cred;
        let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
        let v = String::from_utf8_lossy(bytes).into_owned();
        CredFree(cred as *const _);
        v
      };
      Ok(Some(value))
    }
    Err(e) if is_not_found(&e) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

/// An empty value deletes the entry — clearing the field in settings must not
/// leave the old key behind.
#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
  let target = target(&name)?;
  if value.is_empty() {
    // SAFETY: plain FFI call with a valid, NUL-terminated target string.
    return match unsafe { CredDeleteW(&target, CRED_TYPE_GENERIC, 0) } {
      Ok(()) => Ok(()),
      Err(e) if is_not_found(&e) => Ok(()),
      Err(e) => Err(e.to_string()),
    };
  }
  let mut blob = value.into_bytes();
  let cred = CREDENTIALW {
    Flags: CRED_FLAGS(0),
    Type: CRED_TYPE_GENERIC,
    TargetName: PWSTR(target.as_ptr() as *mut u16),
    CredentialBlobSize: blob.len() as u32,
    CredentialBlob: blob.as_mut_ptr(),
    Persist: CRED_PERSIST_LOCAL_MACHINE,
    ..Default::default()
  };
  // SAFETY: `cred` borrows `target` and `blob`, both alive for the call.
  unsafe { CredWriteW(&cred, 0) }.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names_are_confined_to_this_app() {
    assert!(target("aiApiKey").is_ok());
    assert!(target("").is_err());
    assert!(target("../other").is_err());
    assert!(target("Other:App").is_err());
    assert!(target(&"x".repeat(65)).is_err());
  }

  /// Touches the real Credential Manager, which a CI service session may not
  /// have — run locally with `cargo test --lib -- --ignored secrets`.
  #[test]
  #[ignore]
  fn round_trip_and_delete() {
    let name = "autobook_selftest".to_string();
    secret_set(name.clone(), "sk-test-密钥".into()).unwrap();
    assert_eq!(secret_get(name.clone()).unwrap().as_deref(), Some("sk-test-密钥"));
    secret_set(name.clone(), String::new()).unwrap();
    assert_eq!(secret_get(name.clone()).unwrap(), None);
    secret_set(name, String::new()).unwrap(); // deleting twice is fine
  }
}
