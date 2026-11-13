import { skip } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import { writableSubject } from '$lib/functions/svelte/store';

/**
 * Names whose value currently sits in plaintext localStorage because the
 * credential store refused it. The settings text promises Credential Manager;
 * this is what lets the UI take that back instead of only a console line the
 * release build writes nowhere.
 */
export const plaintextSecrets$ = writableSubject<string[]>([]);

function markPlaintext(name: string, plaintext: boolean) {
  const rest = plaintextSecrets$.getValue().filter((n) => n !== name);
  plaintextSecrets$.next(plaintext ? [...rest, name] : rest);
}

/**
 * A string setting kept in the OS credential store (src-tauri/src/secrets.rs)
 * instead of localStorage, for API keys.
 *
 * Starts from any plaintext copy still in localStorage (so an existing key
 * works on the first frame), moves it into the credential store and deletes
 * the plaintext only once that write succeeded. If the credential store is
 * unreachable — a plain browser tab in dev, or the write fails — the value
 * stays in localStorage: losing the user's key would be worse than keeping
 * the old behaviour.
 */
export function writableSecretSubject(name: string) {
  const legacy = readLegacy(name);
  const subject = writableSubject(legacy);
  let loading = true;
  let typedWhileLoading = false;

  const persist = async (value: string) => {
    try {
      await invoke('secret_set', { name, value });
      localStorage.removeItem(name);
      markPlaintext(name, false);
    } catch (err) {
      console.warn(`[secrets] ${name}: credential store unavailable, kept in localStorage`, err);
      if (value) localStorage.setItem(name, value);
      else localStorage.removeItem(name);
      markPlaintext(name, !!value);
    }
  };

  subject.pipe(skip(1)).subscribe((value) => {
    if (loading) typedWhileLoading = true;
    else void persist(value ?? '');
  });

  if (typeof window !== 'undefined') {
    (async () => {
      try {
        if (legacy) {
          await persist(legacy);
        } else {
          const stored = await invoke<string | null>('secret_get', { name });
          // A key typed while this was in flight wins over the stored one.
          if (stored && !typedWhileLoading) {
            subject.next(stored);
            typedWhileLoading = false; // that was us, not the user
          }
        }
      } catch (err) {
        console.warn(`[secrets] ${name}: could not read the credential store`, err);
      } finally {
        loading = false;
        if (typedWhileLoading) void persist(subject.getValue() ?? '');
      }
    })();
  }
  return subject;
}

function readLegacy(name: string): string {
  try {
    return localStorage.getItem(name) || '';
  } catch {
    return ''; // no localStorage (SSR / node) — nothing to migrate
  }
}
