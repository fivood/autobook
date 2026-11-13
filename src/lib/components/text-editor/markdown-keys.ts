/**
 * Editing keystrokes for the plain-textarea source editor, as pure functions
 * over (text, selection) so they can be tested without a DOM. Each returns the
 * range to replace, the replacement, and where the selection lands — or null
 * to let the browser handle the key. The caller applies it with
 * `execCommand('insertText')`, which keeps the textarea's native undo stack;
 * assigning `value` would wipe it.
 */

export interface TextEdit {
  start: number;
  end: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

const INDENT = '  ';
const LIST_MARKER = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^(\s*>+\s?)/;

function lineStartOf(text: string, pos: number): number {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndOf(text: string, pos: number): number {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i;
}

/**
 * Enter inside a list item or blockquote continues it; Enter on an item that
 * has nothing after its marker ends the list instead of stacking empty items.
 */
export function enterEdit(text: string, selStart: number, selEnd: number): TextEdit | null {
  const lineStart = lineStartOf(text, selStart);
  const lineEnd = lineEndOf(text, selStart);
  const line = text.slice(lineStart, lineEnd);

  let marker: string;
  let next: string;
  const list = LIST_MARKER.exec(line);
  if (list) {
    const [whole, indent, bullet, num, delim, checkbox] = list;
    marker = whole;
    next = indent + (bullet ?? `${Number(num) + 1}${delim}`) + ' ' + (checkbox ? '[ ] ' : '');
  } else {
    const quote = QUOTE_MARKER.exec(line);
    if (!quote) return null;
    marker = next = quote[1];
  }

  // Caret inside the marker itself: a plain newline is what the user means.
  if (selStart < lineStart + marker.length) return null;

  if (selStart === selEnd && !line.slice(marker.length).trim() && selStart === lineEnd) {
    return { start: lineStart, end: lineEnd, insert: '', selStart: lineStart, selEnd: lineStart };
  }

  const insert = '\n' + next;
  const caret = selStart + insert.length;
  return { start: selStart, end: selEnd, insert, selStart: caret, selEnd: caret };
}

/**
 * Tab / Shift+Tab. On a list item or across several lines it shifts whole
 * lines (what nesting a list needs); in running text it just types the indent.
 */
export function indentEdit(
  text: string,
  selStart: number,
  selEnd: number,
  outdent: boolean
): TextEdit | null {
  const blockStart = lineStartOf(text, selStart);
  // A selection ending right at a line start does not include that line.
  const lastPos = selEnd > selStart && text[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const blockEnd = lineEndOf(text, lastPos);
  const block = text.slice(blockStart, blockEnd);
  const multiLine = block.includes('\n');

  if (!outdent && selStart === selEnd && !multiLine && !LIST_MARKER.test(block)) {
    const caret = selStart + INDENT.length;
    return { start: selStart, end: selEnd, insert: INDENT, selStart: caret, selEnd: caret };
  }

  const lines = block.split('\n');
  const deltas = lines.map((l) => {
    if (!outdent) return INDENT.length;
    const lead = /^( {1,2}|\t)/.exec(l);
    return lead ? -lead[1].length : 0;
  });
  if (deltas.every((d) => d === 0)) return null;

  const insert = lines
    .map((l, i) => (outdent ? l.slice(-deltas[i]) : INDENT + l))
    .join('\n');
  const total = deltas.reduce((a, b) => a + b, 0);
  return {
    start: blockStart,
    end: blockEnd,
    insert,
    selStart: Math.max(blockStart, selStart + deltas[0]),
    selEnd: Math.max(blockStart, selEnd + total)
  };
}

/** Ctrl+B / Ctrl+I: wrap the selection, or drop the caret between a fresh pair. */
export function wrapEdit(text: string, selStart: number, selEnd: number, mark: string): TextEdit {
  const inner = text.slice(selStart, selEnd);
  return {
    start: selStart,
    end: selEnd,
    insert: mark + inner + mark,
    selStart: selStart + mark.length,
    selEnd: selEnd + mark.length
  };
}
