<script lang="ts">
  /**
   * Renders one segment's inner content: its images, its text split into the
   * revealed / pending halves, the typewriter cursor at the boundary, and any
   * footnote markers sitting inside the text, and its Markdown styles.
   *
   * Both reading modes go through here — scroll mode just passes the whole
   * segment as revealed. Keeping the split in one place is what stops the
   * marker/cursor interleaving from being written twice (and drifting).
   */
  import type { NoteMark, Segment } from './parse-text';

  export let seg: Segment;
  /** Characters of `seg.text` revealed so far. */
  export let cut: number;
  /** End of the dimmed look-ahead window. */
  export let pendingEnd: number;
  export let hasCursor = false;
  export let cursorOn = false;
  /** Asset key → blob URL. Missing keys render nothing. */
  export let imageUrls: Map<string, string> = new Map();
  export let onNote: (id: string) => void = () => {};
  /** Bound by the parent so it can scroll the caret into view. */
  export let cursorEl: HTMLSpanElement | undefined = undefined;

  type Part =
    | { kind: 'text'; at: number; text: string; pending: boolean; cls: string; href?: string }
    | { kind: 'note'; at: number; note: NoteMark; pending: boolean }
    | { kind: 'cursor'; at: number };

  /**
   * Walk the segment once, emitting text runs broken at `cut`, at every
   * footnote marker and at every style edge. A marker sitting exactly on `cut` counts as revealed —
   * every character before it is already on screen — and the cursor goes
   * after it, which is where a reader expects the caret.
   */
  function buildParts(s: Segment, revealedTo: number, end: number, cursor: boolean): Part[] {
    const parts: Part[] = [];
    const styles = s.styles ?? [];
    let p = 0;
    const pushText = (to: number) => {
      while (p < to) {
        let stop = p < revealedTo ? Math.min(to, revealedTo) : to;
        for (const r of styles) {
          if (r.from > p && r.from < stop) stop = r.from;
          if (r.to > p && r.to < stop) stop = r.to;
        }
        const on = styles.filter((r) => r.from <= p && p < r.to);
        parts.push({
          kind: 'text',
          at: p,
          text: s.text.slice(p, stop),
          pending: p >= revealedTo,
          cls: on.map((r) => `mdi-${r.kind}`).join(' '),
          href: on.find((r) => r.href)?.href
        });
        p = stop;
      }
    };
    for (const note of s.notes ?? []) {
      if (note.at > end) break;
      pushText(note.at);
      parts.push({ kind: 'note', at: note.at, note, pending: note.at > revealedTo });
    }
    pushText(end);
    if (cursor) {
      const idx = parts.findIndex(
        (part) => part.at >= revealedTo && !(part.kind === 'note' && part.at === revealedTo)
      );
      parts.splice(idx < 0 ? parts.length : idx, 0, { kind: 'cursor', at: revealedTo });
    }
    return parts;
  }

  $: parts = buildParts(seg, cut, pendingEnd, hasCursor);
  $: images = (seg.images ?? []).map((key) => imageUrls.get(key)).filter(Boolean) as string[];
</script>

{#if seg.ruleBefore}<span class="md-rule" class:pending={cut === 0} />{/if}{#each images as url}
  <img class="seg-img" src={url} alt="" loading="lazy" />
{/each}{#each parts as part}{#if part.kind === 'cursor'}<span
      class="cursor"
      bind:this={cursorEl}
      class:cursor-on={cursorOn}
    />{:else if part.kind === 'note'}<button
      class="note-mark"
      class:pending={part.pending}
      on:pointerdown|stopPropagation
      on:pointerup|stopPropagation
      on:click|stopPropagation={() => onNote(part.note.id)}>{part.note.n}</button
    >{:else if part.href}<a
      class={part.cls}
      class:pending={part.pending}
      href={part.href}
      target="_blank"
      rel="noopener noreferrer"
      on:pointerdown|stopPropagation
      on:pointerup|stopPropagation
      on:click|stopPropagation>{part.text}</a
    >{:else}<span class={part.cls} class:revealed={!part.pending} class:pending={part.pending}
      >{part.text}</span
    >{/if}{/each}

<style>
  /* Look-ahead text: there, but only just, so the eye stays on the caret. */
  .pending {
    opacity: 0.12;
  }
  .cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    margin: 0 1px;
    vertical-align: -0.15em;
    background: var(--accent);
    opacity: 0;
  }
  .cursor-on {
    opacity: 0.85;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .md-rule {
    display: block;
    margin: 0.6em 0 1.4em;
    border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  }
  .mdi-b {
    font-weight: 700;
  }
  .mdi-i {
    font-style: italic;
  }
  .mdi-s {
    text-decoration: line-through;
  }
  /* No horizontal padding: a run split at the caret would show it twice. */
  .mdi-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: color-mix(in srgb, currentColor 10%, transparent);
    border-radius: 3px;
  }
  .mdi-a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  /* Colour, not opacity, so it composes with the look-ahead dimming. */
  .mdi-sep {
    color: color-mix(in srgb, currentColor 35%, transparent);
  }

  .seg-img {
    display: block;
    max-width: 100%;
    /* Plates shouldn't push the text a full screen away; the reader can
       still see the whole image without leaving the paragraph. */
    max-height: 60vh;
    margin: 0.6em auto;
    object-fit: contain;
  }

  /* Superscript number in place of the publisher's footnote glyph. Sized in
     em so it tracks the reader's font-size slider. */
  .note-mark {
    font-size: 0.62em;
    vertical-align: super;
    line-height: 0;
    padding: 0 0.15em;
    margin: 0 0.1em;
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.75;
    cursor: pointer;
    /* Fingers need more than 0.6em; grow the hit box without moving the
       glyph or disturbing line height. */
    position: relative;
  }
  .note-mark::after {
    content: '';
    position: absolute;
    inset: -0.9em -0.6em;
  }
  .note-mark.pending {
    opacity: 0.28;
  }
</style>
