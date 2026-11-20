import type { Section } from '$lib/data/database/books-db/versions/books-db';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';
import { textNodesUnder } from '$lib/components/book-reader/book-highlight/highlight-renderer';
import { getCharacterCount } from '$lib/functions/get-character-count';

export type ReaderSection = Section & {
  /** Offset in the highlight basis (raw text, see `rangeToOffsets`). */
  textStart?: number;
};

/**
 * Recount section offsets from the rendered book, on the reader's own basis.
 *
 * The loaders disagree on what a "character" is: EPUB counts like the reader
 * (letters and ideographs only), TXT / MD / MOBI count every code point,
 * blank lines and punctuation included. The TOC and chapter % compare
 * `startCharacter` against the footer's explored count, so a TXT's chapter 2
 * showed "from 1032" while the footer at the same spot read 896. Recounting
 * here covers books already in the library without rewriting their rows.
 *
 * Highlights use a third basis (raw text offsets), hence `textStart`.
 */
export function rebaseSections(sections: Section[] | undefined, root: Element): ReaderSection[] {
  if (!sections?.length) return [];
  const els = sections.map((s) => root.querySelector(`[id="${CSS.escape(s.reference)}"]`));
  if (els.some((el) => !el)) return sections;

  const startsOf = <T extends Node>(nodes: T[], weigh: (n: T) => number) => {
    let p = 0;
    let total = 0;
    const starts = els.map((el) => {
      while (p < nodes.length && el!.compareDocumentPosition(nodes[p]) & Node.DOCUMENT_POSITION_PRECEDING) {
        total += weigh(nodes[p]);
        p += 1;
      }
      return total;
    });
    while (p < nodes.length) {
      total += weigh(nodes[p]);
      p += 1;
    }
    return { starts, total };
  };

  const reader = startsOf(getParagraphNodes(root), getCharacterCount);
  const text = startsOf(textNodesUnder(root), (n) => n.textContent?.length || 0);

  const mainIdx = sections.flatMap((s, i) => (s.parentChapter ? [] : [i]));
  const nextMainStart = new Map(
    mainIdx.map((i, k) => [i, k + 1 < mainIdx.length ? reader.starts[mainIdx[k + 1]] : reader.total])
  );

  return sections.map((s, i) =>
    s.parentChapter
      ? { ...s, textStart: text.starts[i] }
      : {
          ...s,
          startCharacter: reader.starts[i],
          characters: nextMainStart.get(i)! - reader.starts[i],
          textStart: text.starts[i]
        }
  );
}

/**
 * A highlight's start (raw text offset) as a reader position, so a jump to it
 * can go through the reader's own position restore — the one path that is
 * right in both view modes and both writing directions. Scrolling the mark
 * into view instead raced that restore and lost: the saved bookmark landed
 * afterwards and the highlight ended up a screen away.
 */
export function readerPosOfTextOffset(root: Element, offset: number): number | undefined {
  let acc = 0;
  let target: Text | undefined;
  for (const n of textNodesUnder(root)) {
    const len = n.textContent?.length || 0;
    if (offset < acc + len) {
      target = n;
      break;
    }
    acc += len;
  }
  if (!target) return undefined;

  let pos = 0;
  for (const n of getParagraphNodes(root)) {
    if (n === target) {
      const head = root.ownerDocument.createTextNode(target.data.slice(0, offset - acc));
      return pos + getCharacterCount(head);
    }
    if (target.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) return pos;
    pos += getCharacterCount(n);
  }
  return pos;
}
