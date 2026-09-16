<script lang="ts">
  /**
   * One segment as a block: the chapter-title / paragraph element around
   * SegmentBody, dressed by its Markdown block kind when it has one.
   */
  import SegmentBody from './segment-body.svelte';
  import type { Segment } from './parse-text';

  export let seg: Segment;
  export let cut: number;
  export let pendingEnd: number;
  export let hasCursor = false;
  export let cursorOn = false;
  export let imageUrls: Map<string, string> = new Map();
  export let onNote: (id: string) => void = () => {};
  /** Scroll mode finds the segment at the viewport top through this. */
  export let anchor = false;
  /** Markdown books drop the novel-style first-line indent. */
  export let markdown = false;

  // `ol:2:3` → kind `ol`, arg 2 (depth), num 3; `code:te` → arg `te` (edges).
  $: [kind = '', arg = '', num = ''] = (seg.block ?? '').split(':');
  $: depth = kind === 'code' ? '' : arg;
</script>

<svelte:element
  this={seg.type === 'h2' ? 'h2' : 'p'}
  class={seg.type === 'h2' ? 'ch-title' : 'ch-para'}
  class:md={markdown}
  class:md-h1={kind === 'h1'}
  class:md-h2={kind === 'h2'}
  class:md-h3={kind === 'h3'}
  class:md-h4={kind === 'h4'}
  class:md-h5={kind === 'h5' || kind === 'h6'}
  class:md-quote={kind === 'quote'}
  class:md-item={kind === 'ul' || kind === 'ol' || kind === 'li'}
  class:md-code={kind === 'code'}
  class:md-code-top={kind === 'code' && arg.includes('t')}
  class:md-code-end={kind === 'code' && arg.includes('e')}
  class:md-row={kind === 'row' || kind === 'thead'}
  class:md-thead={kind === 'thead'}
  class:unrevealed={markdown && cut === 0}
  data-seg-start={anchor ? seg.startChar : undefined}
  data-kind={kind || undefined}
  data-depth={depth || undefined}
  data-n={kind === 'ol' ? num : undefined}
  style:--md-depth={depth || undefined}
>
  <SegmentBody {seg} {cut} {pendingEnd} {hasCursor} {cursorOn} {imageUrls} {onNote} />
</svelte:element>

<style>
  .ch-title {
    margin: 2.2em 0 1em;
    font-size: 1.35em;
    font-weight: 600;
    line-height: 1.4;
    text-align: center;
    letter-spacing: 0.05em;
  }
  .ch-title:first-child {
    margin-top: 0.5em;
  }
  .ch-para {
    margin: 0 0 1em;
    text-indent: 2em;
    white-space: pre-wrap;
  }

  /* ---- Markdown: reads like a rendered document, not a novel ---- */
  .md {
    text-indent: 0;
  }
  .ch-title.md {
    text-align: left;
    letter-spacing: 0;
  }
  .md-h1,
  .md-h2 {
    padding-bottom: 0.25em;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  }
  .md-h1 {
    font-size: 1.6em;
  }
  .md-h3,
  .md-h4,
  .md-h5 {
    margin: 1.4em 0 0.5em;
    font-weight: 600;
    line-height: 1.4;
  }
  .md-h3 {
    font-size: 1.2em;
  }
  .md-h4 {
    font-size: 1.05em;
  }
  .md-h5 {
    font-size: 0.95em;
    color: var(--fg-dim);
  }

  .md-quote {
    margin: 0;
    padding: 0.1em 0 0.1em 0.9em;
    border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
    color: var(--fg-dim);
  }
  /* Consecutive quote lines read as one block; space only after the last. */
  .md-quote:not(:has(+ .md-quote)) {
    margin-bottom: 1em;
  }

  .md-item {
    position: relative;
    margin: 0 0 0.35em;
    padding-left: calc(var(--md-depth, 1) * 1.5em);
  }
  .md-item:not(:has(+ .md-item)) {
    margin-bottom: 1em;
  }
  .md-item::before {
    position: absolute;
    left: calc(var(--md-depth, 1) * 1.5em - 1.5em);
    width: 1.2em;
    text-align: right;
  }
  [data-kind='ul']::before {
    content: '•';
  }
  [data-kind='ul'][data-depth='2']::before {
    content: '◦';
  }
  [data-kind='ul'][data-depth='3']::before,
  [data-kind='ul'][data-depth='4']::before {
    content: '▪';
  }
  [data-kind='ol']::before {
    content: attr(data-n) '.';
    font-variant-numeric: tabular-nums;
  }

  /* Bullets, rules, bars and boxes wait with their text: a block typing
     hasn't reached is dimmed whole, and its look-ahead text is let off its
     own dimming so it isn't faded twice. */
  .unrevealed {
    opacity: 0.12;
  }
  .unrevealed :global(.pending) {
    opacity: 1;
  }

  /* One box per fence: lines butt together, the box's padding and corners
     go on the first and last line (flagged by the loader). */
  .md-code {
    margin: 0;
    padding: 0 0.9em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.82em;
    line-height: 1.65;
    overflow-wrap: anywhere;
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
  .md-code-top {
    padding-top: 0.6em;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
  }
  .md-code-end {
    padding-bottom: 0.6em;
    margin-bottom: 1em;
    border-bottom-left-radius: 6px;
    border-bottom-right-radius: 6px;
  }

  .md-row {
    margin: 0;
    padding: 0.25em 0.4em;
    font-size: 0.92em;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }
  .md-thead {
    margin-top: 0.4em;
    font-weight: 600;
    border-bottom-color: color-mix(in srgb, currentColor 30%, transparent);
  }
  .md-row:not(:has(+ .md-row)) {
    margin-bottom: 1em;
  }
</style>
