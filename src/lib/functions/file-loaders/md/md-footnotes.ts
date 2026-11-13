/**
 * Pandoc/GFM footnotes (`text[^1]` … `[^1]: note`). marked has no footnote
 * syntax, and the extensions for it can't be used here anyway: the loader
 * parses each heading section separately, and definitions usually sit at the
 * end of the file — far from the sections that reference them. So this pass
 * runs over the whole source first, pulls definitions out and turns
 * references into plain HTML that marked passes through.
 *
 * The note bodies come back separately for the loader to render at the end of
 * the book; the reader's note popup (footnote.ts) recognizes the result.
 */

const DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const CONTINUATION_RE = /^(?: {4}|\t)\S/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const REF_RE = /\[\^([^\]\s]+)\]/g;
// Inline code is left alone: `[^1]` inside backticks is literal text.
const CODE_SPAN_RE = /(`+[^`]*`+)/;

/** Feeds lines through, reporting whether each is inside a fenced block. */
function fenceTracker() {
  let open: string | null = null;
  return (line: string) => {
    const m = FENCE_RE.exec(line);
    if (!m) return open !== null;
    if (open === null) open = m[1][0];
    else if (m[1][0] === open) open = null;
    return true;
  };
}

export interface MdFootnote {
  n: number;
  /** Raw markdown of the note body, for the caller to render inline. */
  text: string;
}

export function extractMdFootnotes(src: string): { text: string; notes: MdFootnote[] } {
  const lines = src.split(/\r?\n/);
  const defs = new Map<string, string>();
  const body: string[] = [];
  const inFence = fenceTracker();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = inFence(line) ? null : DEF_RE.exec(line);
    if (!m) {
      body.push(line);
      continue;
    }
    const parts = [m[2]];
    while (i + 1 < lines.length && CONTINUATION_RE.test(lines[i + 1])) {
      parts.push(lines[(i += 1)].trim());
    }
    if (!defs.has(m[1])) defs.set(m[1], parts.join(' ').trim());
  }

  if (!defs.size) return { text: src, notes: [] };

  // Numbered by first reference, the way they read, not by label.
  const order: string[] = [];
  const inFence2 = fenceTracker();
  const text = body
    .map((line) => {
      if (inFence2(line)) return line;
      return line
        .split(CODE_SPAN_RE)
        .map((seg, k) =>
          k % 2
            ? seg
            : seg.replace(REF_RE, (all, label: string) => {
                if (!defs.has(label)) return all;
                let n = order.indexOf(label) + 1;
                const first = !n;
                if (first) n = order.push(label);
                const id = first ? ` id="md-fnref-${n}"` : '';
                return `<sup class="md-footnote-ref"><a class="md-footnote-ref" href="#md-fn-${n}"${id}>${n}</a></sup>`;
              })
        )
        .join('');
    })
    .join('\n');

  return { text, notes: order.map((label, i) => ({ n: i + 1, text: defs.get(label)! })) };
}
