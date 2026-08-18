<script lang="ts">
  /**
   * Renders one segment's inner content: its images, its text split into the
   * revealed / pending halves, the typewriter cursor at the boundary, and any
   * footnote markers sitting inside the text.
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
    | { kind: 'text'; at: number; text: string; pending: boolean }
    | { kind: 'note'; at: number; note: NoteMark; pending: boolean }
    | { kind: 'cursor'; at: number };

  /**
   * Walk the segment once, emitting text runs broken at `cut` and at every
   * footnote marker. A marker sitting exactly on `cut` counts as revealed —
   * every character before it is already on screen — and the cursor goes
   * after it, which is where a reader expects the caret.
   */
  function buildParts(s: Segment, revealedTo: number, end: number, cursor: boolean): Part[] {
    const parts: Part[] = [];
    let p = 0;
    const pushText = (to: number) => {
      while (p < to) {
        const stop = p < revealedTo ? Math.min(to, revealedTo) : to;
        parts.push({ kind: 'text', at: p, text: s.text.slice(p, stop), pending: p >= revealedTo });
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

{#each images as url}
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
    >{:else}<span class:revealed={!part.pending} class:pending={part.pending}>{part.text}</span
    >{/if}{/each}

<style>
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
