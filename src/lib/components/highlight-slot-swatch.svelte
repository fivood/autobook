<script lang="ts">
  /**
   * The slot marker used everywhere outside the text: context-menu chip,
   * sidebar dot, notebook filter pill and list dot, note editor picker.
   *
   * Carries the slot number rather than relying on colour. Under the `invert`
   * palette all four slots share one hue and differ only by fill and ring, and
   * a 3px dotted ring simply does not read on a 12px dot — the number does.
   * It also gives the picker a label it never had.
   *
   * The digit uses the style's `label` colour rather than `ink`, so it keeps
   * full strength on the faintest slot instead of converging with its own wash.
   */
  import type { HighlightSlot } from '$lib/data/database/books-db/versions/books-db';
  import { slotSwatchStyle } from '$lib/data/highlight-color';
  import { highlightSlotStyles$ } from '$lib/data/store';

  export let slot: HighlightSlot;
  /** Caller owns sizing and margins. Keep the box at 1rem or more, below that
   *  the digit stops being legible and the swatch is back to colour-only. */
  let className = 'h-5 w-5 text-[0.6rem]';
  export { className as class };

  $: style = $highlightSlotStyles$[slot];
</script>

<span
  class="inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold leading-none {className}"
  style="{slotSwatchStyle(style)};color:{style.label}"
  aria-hidden="true">{slot}</span>
