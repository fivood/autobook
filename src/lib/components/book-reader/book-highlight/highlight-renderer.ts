import type { BooksDbHighlight } from '$lib/data/database/books-db/versions/books-db';

const HL_ATTR = 'data-hl-id';
const HL_CLASS_MAP: Record<string, string> = {
  yellow: 'hl-yellow',
  blue: 'hl-blue',
  green: 'hl-green',
  pink: 'hl-pink'
};

function textNodesUnder(root: Node): Text[] {
  const result: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement?.closest('rt, script, style, [aria-hidden], [hidden]')) continue;
    result.push(node);
  }
  return result;
}

export function rangeToOffsets(
  container: HTMLElement,
  range: Range
): { start: number; end: number } | undefined {
  const nodes = textNodesUnder(container);
  let offset = 0;
  let start = -1;
  let end = -1;
  for (const node of nodes) {
    const len = node.textContent?.length || 0;
    if (start < 0 && node === range.startContainer) {
      start = offset + range.startOffset;
    }
    if (end < 0 && node === range.endContainer) {
      end = offset + range.endOffset;
    }
    if (start >= 0 && end >= 0) break;
    offset += len;
  }
  if (start < 0 || end < 0 || start >= end) return undefined;
  return { start, end };
}

function clearHighlightMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll<HTMLElement>(`mark[${HL_ATTR}]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode!;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
  container.normalize();
}

function applyHighlightsToDOM(
  container: HTMLElement,
  highlights: BooksDbHighlight[]
): void {
  if (!highlights.length) return;

  const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);
  const textNodes = textNodesUnder(container);

  interface WrapOp {
    node: Text;
    hlStart: number;
    hlEnd: number;
    hlId: number;
    color: string;
  }

  const ops: WrapOp[] = [];
  let offset = 0;
  let hlIdx = 0;

  for (const node of textNodes) {
    const len = node.textContent?.length || 0;
    const nodeEnd = offset + len;

    while (hlIdx < sorted.length && sorted[hlIdx].startOffset < nodeEnd) {
      const hl = sorted[hlIdx];
      if (hl.endOffset > offset) {
        const hlStart = Math.max(0, hl.startOffset - offset);
        const hlEnd = Math.min(len, hl.endOffset - offset);
        ops.push({ node, hlStart, hlEnd, hlId: hl.id, color: hl.color });
      }
      if (hl.endOffset <= nodeEnd) {
        hlIdx++;
      } else {
        break;
      }
    }

    offset += len;
    if (hlIdx >= sorted.length) break;
  }

  for (let i = ops.length - 1; i >= 0; i--) {
    const { node, hlStart, hlEnd, hlId, color } = ops[i];
    const cls = HL_CLASS_MAP[color] || HL_CLASS_MAP.yellow;

    let target: Text = node;
    if (hlEnd < (node.textContent?.length || 0)) {
      target.splitText(hlEnd);
    }
    if (hlStart > 0) {
      target = target.splitText(hlStart);
    }

    const mark = document.createElement('mark');
    mark.className = cls;
    mark.setAttribute(HL_ATTR, String(hlId));
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

export function renderHighlights(
  container: HTMLElement,
  highlights: BooksDbHighlight[]
): void {
  clearHighlightMarks(container);
  applyHighlightsToDOM(container, highlights);
}

export function scrollToHighlight(container: HTMLElement, hl: BooksDbHighlight): void {
  const mark = container.querySelector(`mark[${HL_ATTR}="${hl.id}"]`);
  if (mark) {
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function getHighlightIdFromElement(el: HTMLElement): number | undefined {
  const mark = el.closest(`mark[${HL_ATTR}]`);
  if (!mark) return undefined;
  const id = mark.getAttribute(HL_ATTR);
  return id ? Number(id) : undefined;
}
