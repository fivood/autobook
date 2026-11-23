<script lang="ts">
  /**
   * Note box for WeRead (微信读书) exports, which keep a note's text in
   * `data-wr-footernote` on an empty span and show it with their own CSS hover
   * box — `position: fixed` on the span's `::after`. The paginated reader shows
   * a section's short last page by translating the content, and a transformed
   * ancestor captures fixed descendants, so on every chapter's final page that
   * box landed thousands of pixels off-screen. This one lives outside the book
   * content; styles.scss switches the book's box off.
   *
   * EPUB note links (footnote.ts) open the same box on click. That one stays
   * until the next click elsewhere, and takes the pointer so a long note can be
   * scrolled and copied.
   */
  import { onDestroy, tick } from 'svelte';
  import { footnote$ } from './footnote';
  import { t } from '$lib/i18n';

  const MARKER = '.book-content span.reader_footer_note';
  const GAP = 8;
  const EDGE = 12;

  let text = '';
  let box: HTMLDivElement | undefined;
  let left = 0;
  let top = 0;
  let fontSize = 16;
  let clicked = false;
  let jump: (() => void) | undefined;

  const sub = footnote$.subscribe(({ anchor, text: t, jump: j }) => {
    clicked = true;
    jump = j;
    // The marker itself is usually shrunk (superscript, 0.75em); size off the
    // paragraph it sits in.
    place(anchor, t, anchor.closest('p,li,dd,div,blockquote') ?? anchor);
  });
  onDestroy(() => sub.unsubscribe());

  function marker(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(MARKER) : null;
  }

  function show(ev: MouseEvent) {
    if (clicked && text) return;
    const el = marker(ev.target);
    if (!el) return;
    clicked = false;
    jump = undefined;
    place(el, el.dataset.wrFooternote ?? '');
  }

  async function place(el: Element, t: string, sizeFrom: Element = el) {
    text = t;
    if (!text) return;
    // A size step below the text it annotates, following the reader's font
    // size setting.
    fontSize = parseFloat(getComputedStyle(sizeFrom).fontSize) * 0.85 || 16;
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
    if (ev?.type === 'mouseout' && (clicked || !marker(ev.target))) return;
    if (clicked && ev?.target instanceof Node && box?.contains(ev.target)) return;
    // Ctrl+C on a selection inside the box mustn't close it before the copy.
    if (ev instanceof KeyboardEvent && (ev.ctrlKey || ev.metaKey || ev.key === 'Shift')) return;
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
    class:wr-note--clicked={clicked}
    role={clicked ? 'note' : 'tooltip'}
    bind:this={box}
    style:left="{left}px"
    style:top="{top}px"
    style:font-size="{fontSize}px"
  >
    {text}
    {#if clicked && jump}
      <button
        class="wr-note__jump"
        on:click={() => {
          const go = jump;
          text = '';
          go?.();
        }}>{$t('footnote.jump')}</button
      >
    {/if}
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
  .wr-note__jump {
    display: block;
    margin-top: 0.4em;
    margin-left: auto;
    font-size: 0.85em;
    color: var(--link-color, currentColor);
    opacity: 0.85;
  }
  .wr-note__jump:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .wr-note--clicked {
    max-height: 50vh;
    overflow-y: auto;
    pointer-events: auto;
    user-select: text;
  }
</style>
