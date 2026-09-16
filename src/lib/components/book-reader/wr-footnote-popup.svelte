<script lang="ts">
  /**
   * Note box for WeRead (微信读书) exports, which keep a note's text in
   * `data-wr-footernote` on an empty span and show it with their own CSS hover
   * box — `position: fixed` on the span's `::after`. The paginated reader shows
   * a section's short last page by translating the content, and a transformed
   * ancestor captures fixed descendants, so on every chapter's final page that
   * box landed thousands of pixels off-screen. This one lives outside the book
   * content; styles.scss switches the book's box off.
   */
  import { tick } from 'svelte';

  const MARKER = '.book-content span.reader_footer_note';
  const GAP = 8;
  const EDGE = 12;

  let text = '';
  let box: HTMLDivElement | undefined;
  let left = 0;
  let top = 0;
  let fontSize = 16;

  function marker(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(MARKER) : null;
  }

  async function show(ev: MouseEvent) {
    const el = marker(ev.target);
    if (!el) return;
    text = el.dataset.wrFooternote ?? '';
    if (!text) return;
    // A size step below the text it annotates, following the reader's font
    // size setting.
    fontSize = parseFloat(getComputedStyle(el).fontSize) * 0.85 || 16;
    await tick();
    if (!box) return;
    // Above the marker when it fits, else below; centred on it and kept
    // inside the window either way.
    const r = el.getBoundingClientRect();
    const { width, height } = box.getBoundingClientRect();
    left = Math.min(Math.max(EDGE, r.left + r.width / 2 - width / 2), innerWidth - width - EDGE);
    top = r.top - GAP - height >= EDGE ? r.top - GAP - height : r.bottom + GAP;
  }

  function hide(ev?: Event) {
    if (!text) return;
    if (ev?.type === 'mouseout' && !marker(ev.target)) return;
    text = '';
  }
</script>

<!-- The content can move under a still pointer (scrolling, page flips,
     auto-scroll), which fires no mouseout — so any of those closes the box. -->
<svelte:window
  on:mouseover={show}
  on:mouseout={hide}
  on:scroll|capture={hide}
  on:wheel|passive={hide}
  on:keydown={hide}
  on:pointerdown={hide}
/>

{#if text}
  <div
    class="wr-note"
    role="tooltip"
    bind:this={box}
    style:left="{left}px"
    style:top="{top}px"
    style:font-size="{fontSize}px"
  >
    {text}
  </div>
{/if}

<style>
  .wr-note {
    position: fixed;
    z-index: 60;
    width: max-content;
    max-width: min(36rem, calc(100vw - 24px));
    padding: 0.7em 1em;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    border-radius: 8px;
    /* A shade off the page, so it lifts in dark themes too, where the shadow
       doesn't show. */
    background: color-mix(in srgb, var(--background-color) 94%, var(--font-color));
    color: var(--font-color);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
    font-family: var(--font-family-serif, 'Noto Sans SC', 'Noto Serif JP', serif);
    line-height: 1.7;
    white-space: normal;
    pointer-events: none;
  }
</style>
