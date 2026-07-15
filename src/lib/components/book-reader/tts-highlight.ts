/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 *
 * Visually marks the sentence the TTS engine is currently speaking using the
 * CSS Custom Highlight API (Chromium 105+, also available in WebView2). The
 * sentence boundaries come from the AutoReader's `paragraphs[]` (which
 * already splits on 。！？.!? etc.), so we just need to map the engine's
 * paragraph index to a DOM Range over the same text.
 *
 * We walk the content element once on `prepare()` and snapshot every text
 * node along with its global character offset (matching `extractText()`'s
 * walk order so the indices line up). On each `setRange()` we binary-search
 * the snapshot for the start and end text nodes.
 *
 * If the Highlight API isn't available (e.g., older mobile WebKit), this
 * class is a no-op — TTS still works, just without the visual cue.
 */

interface Segment {
  node: Text;
  start: number;
  end: number;
}

const HIGHLIGHT_NAME = 'tts-sentence';

// CSS Custom Highlight API (window.Highlight / CSS.highlights) isn't in the
// TS DOM lib version we ship; the `as any` casts here and in apply()/clear()
// reach through it. Feature-detected at runtime since Safari lacks it.
function hasHighlightApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).Highlight === 'function' &&
    typeof CSS !== 'undefined' &&
    typeof (CSS as any).highlights?.set === 'function'
  );
}

export class TtsHighlighter {
  private segments: Segment[] = [];
  private highlight: any = null;
  private supported = false;

  prepare(root: HTMLElement | undefined) {
    this.clear();
    this.segments = [];
    if (!root) return;
    this.supported = hasHighlightApi();
    if (!this.supported) return;

    // Match extractText()'s text-node walk so character indices line up. We
    // honor the same script/style skip and prefer .tw-c spans when present
    // (typewriter wraps each char in one) — that keeps indices stable while
    // typewriter playback is in progress.
    const twcSpans = root.querySelectorAll('.tw-c');
    if (twcSpans.length > 0) {
      let total = 0;
      for (const span of twcSpans) {
        const textNode = span.firstChild as Text | null;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
          total += (span.textContent || '').length;
          continue;
        }
        const len = (textNode.textContent || '').length;
        if (len > 0) {
          this.segments.push({ node: textNode, start: total, end: total + len });
        }
        total += len;
      }
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let total = 0;
    let node: Node | null = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent) {
        const tag = parent.tagName;
        if (tag !== 'SCRIPT' && tag !== 'STYLE') {
          const text = node.textContent || '';
          if (text.length > 0) {
            this.segments.push({ node: node as Text, start: total, end: total + text.length });
            total += text.length;
          }
        }
      }
      node = walker.nextNode();
    }
  }

  /** Highlight a global character range (within the prepared root). */
  setRange(globalStart: number, globalEnd: number) {
    if (!this.supported || !this.segments.length) return;
    if (globalEnd <= globalStart) return;
    const start = this.locate(globalStart);
    const end = this.locate(Math.min(globalEnd, this.segments[this.segments.length - 1].end));
    if (!start || !end) return;
    try {
      const range = new Range();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const HL: any = (window as any).Highlight;
      this.highlight = new HL(range);
      (CSS as any).highlights.set(HIGHLIGHT_NAME, this.highlight);
    } catch {
      // Range/Highlight construction can fail if the DOM mutated between
      // prepare() and now — just bail silently.
    }
  }

  clear() {
    if (!this.supported) return;
    try {
      (CSS as any).highlights?.delete(HIGHLIGHT_NAME);
    } catch {
      /* ignore */
    }
    this.highlight = null;
  }

  private locate(globalIdx: number): { node: Text; offset: number } | null {
    if (!this.segments.length) return null;
    // Binary search: segments are sorted by start.
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const seg = this.segments[mid];
      if (globalIdx < seg.start) hi = mid - 1;
      else if (globalIdx > seg.end) lo = mid + 1;
      else return { node: seg.node, offset: globalIdx - seg.start };
    }
    // Past the end — clamp to last node.
    const last = this.segments[this.segments.length - 1];
    return { node: last.node, offset: (last.node.textContent || '').length };
  }
}
