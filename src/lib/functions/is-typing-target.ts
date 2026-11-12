const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
  'file',
  'image'
]);

/**
 * True when a key event came from somewhere the user is entering text.
 *
 * Every window-level reader shortcut must bail on this. The reader binds bare
 * letters and Space (b/r/a/d/v/n/m/t/p/f, arrows), and its handler ends with
 * `activeElement.blur()` — so without this guard, typing 「a bad day」 in the
 * AI drawer ran four reader actions and dropped the caret at the first space.
 * The `skipKeyDownListener$` flag each dialog sets by hand is opt-in; this is
 * not, so a new input anywhere in the reader is covered without remembering.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.isContentEditable) return true;
  const field = el.closest('input, textarea, select');
  if (!field) return false;
  return !(field instanceof HTMLInputElement) || !NON_TEXT_INPUTS.has(field.type);
}
