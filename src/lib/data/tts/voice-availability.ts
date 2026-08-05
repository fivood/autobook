/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * "Listed ≠ usable" for voice pickers.
 *
 * Every TTS voice list in this app is a *claim* about what exists somewhere
 * else: the OS speech stack (SAPI / Web Speech) or Microsoft's hosted
 * catalog (Edge). The saved id can stop matching that claim without anything
 * being wrong locally — the user uninstalls a Windows voice pack, moves
 * settings to another machine, or Microsoft retires a neural voice.
 *
 * What used to happen: `<select bind:value>` finds no matching `<option>`,
 * renders **blank**, and the reader quietly falls back to auto-select. The
 * user sees an empty dropdown and gets a different voice with no explanation.
 *
 * The rule here is the same one the model-availability work landed on: a
 * selection that can't be resolved right now is *reported*, never silently
 * dropped. In particular the saved id is NOT cleared — absence is often
 * temporary (Web Speech's list is empty until `voiceschanged` fires) or
 * machine-local (the voice is still there on the user's other laptop), and
 * an auto-clear would destroy the choice permanently to fix a display glitch.
 */

export type VoiceSelectionState =
  /** Nothing chosen — the engine's own default applies. Not a problem. */
  | 'unset'
  /** Chosen and present in the live list. */
  | 'ok'
  /** The list hasn't arrived yet; too early to judge. */
  | 'unknown'
  /** Chosen but absent from a list we did receive. */
  | 'missing';

export function checkVoiceSelection(
  selectedId: string | undefined,
  availableIds: readonly string[]
): VoiceSelectionState {
  if (!selectedId) return 'unset';
  // An empty list means "not enumerated yet", not "nothing exists" — Web
  // Speech returns [] on first call in Chrome, and SAPI enumeration is an
  // async IPC round-trip. Calling that `missing` would flash a scary hint
  // on every settings open.
  if (!availableIds.length) return 'unknown';
  return availableIds.includes(selectedId) ? 'ok' : 'missing';
}
